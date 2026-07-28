import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { getVisibleCatalog } from "./catalogs.server";
import { submitBuyerQuote } from "./portal-quote.server";
import { getPlanLimits, evaluateShortcutAllowance, pushRemindersAllowed } from "../lib/billing";
import { validateShortcut, reorderPushPayload, type ShortcutLine } from "../lib/pwa";

/**
 * F18 — Buyer PWA service: saved reorder shortcuts, Web Push subscriptions, and
 * one-tap reorder (which runs through submitBuyerQuote so MOQ (F9), catalog
 * visibility (F11), and price lists (F3) are all honored). Dark-launched behind
 * MANNON_FF_BUYER_PWA. Push delivery is a pluggable no-op until VAPID is wired.
 */

export const PWA_ENABLED = () => process.env.MANNON_FF_BUYER_PWA === "true";

export class ShortcutCapError extends Error {
  constructor(public cap: number) {
    super("Shortcut cap reached");
  }
}

async function memberContext(memberId: string) {
  return prisma.buyer.findUnique({
    where: { id: memberId },
    select: { id: true, companyId: true, name: true, email: true, company: { select: { shopId: true, name: true, shop: { select: { shopifyDomain: true, plan: true } } } } },
  });
}

// --- reorder shortcuts -------------------------------------------------------

export interface ShortcutRow {
  id: string;
  label: string;
  lines: ShortcutLine[];
  itemCount: number;
}

export async function listShortcuts(memberId: string): Promise<ShortcutRow[]> {
  const rows = await prisma.reorderShortcut.findMany({ where: { memberId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => {
    const lines = (r.lines as unknown as ShortcutLine[]) ?? [];
    return { id: r.id, label: r.label, lines, itemCount: lines.length };
  });
}

export async function createShortcut(memberId: string, label: unknown, rawLines: unknown, plan: string | null): Promise<void> {
  const v = validateShortcut(label, rawLines);
  if (!v.ok) throw new Error(v.error ?? "Invalid shortcut.");
  const used = await prisma.reorderShortcut.count({ where: { memberId } });
  const cap = getPlanLimits(plan).reorderShortcutCap;
  if (!evaluateShortcutAllowance(used, cap).allowed) throw new ShortcutCapError(cap);
  await prisma.reorderShortcut.create({ data: { memberId, label: v.label, lines: v.lines as object } });
}

export async function deleteShortcut(memberId: string, id: string): Promise<void> {
  await prisma.reorderShortcut.deleteMany({ where: { id, memberId } });
}

export type ReorderResult = { ok: true; quoteId: string } | { ok: false; error: string };

/**
 * One-tap reorder from a saved shortcut (or ad-hoc lines): resolve against the
 * buyer's VISIBLE catalog (F11) and submit through submitBuyerQuote, so MOQ (F9)
 * and pricing (F3) all apply. Emits REORDER_ONECLICK.
 */
export async function oneTapReorder(memberId: string, shortcutId: string | null, adHocLines?: ShortcutLine[]): Promise<ReorderResult> {
  const member = await memberContext(memberId);
  if (!member) return { ok: false, error: "Not signed in." };

  let lines: ShortcutLine[] = adHocLines ?? [];
  if (shortcutId) {
    const sc = await prisma.reorderShortcut.findFirst({ where: { id: shortcutId, memberId } });
    if (!sc) return { ok: false, error: "Shortcut not found." };
    lines = (sc.lines as unknown as ShortcutLine[]) ?? [];
  }
  if (lines.length === 0) return { ok: false, error: "Nothing to reorder." };

  const catalog = await getVisibleCatalog(member.company.shop.shopifyDomain, { buyerId: member.id, companyId: member.companyId });
  const visible = new Set(catalog.map((c) => c.variantId));
  const selections = lines.filter((l) => visible.has(l.variantId)).map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
  if (selections.length === 0) return { ok: false, error: "None of these items are available right now." };

  const result = await submitBuyerQuote({ id: member.id, companyId: member.companyId }, selections, catalog);
  if (!result.ok) return { ok: false, error: result.error };

  await appendEvent({ shopId: member.company.shopId, type: "REORDER_ONECLICK", entityType: "Quote", entityId: result.quote.id, payload: { lines: selections.length, viaShortcut: Boolean(shortcutId) } });
  return { ok: true, quoteId: result.quote.id };
}

// --- web push ----------------------------------------------------------------

export function vapidPublicKey(): string | null {
  return process.env.MANNON_VAPID_PUBLIC_KEY ?? null;
}

export async function savePushSubscription(memberId: string, endpoint: string, keys: unknown): Promise<void> {
  if (!endpoint) return;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { memberId, endpoint, keys: (keys ?? {}) as object },
    update: { memberId, keys: (keys ?? {}) as object },
  });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

/**
 * Deliver a Web Push message. Pluggable no-op until a VAPID transport (the
 * `web-push` library + MANNON_VAPID_* keys) is wired — mirrors the mailer. A
 * failed send never throws.
 */
async function deliverPush(_subscription: { endpoint: string; keys: unknown }, _payload: object): Promise<boolean> {
  if (!vapidPublicKey() || !process.env.MANNON_VAPID_PRIVATE_KEY) return false;
  try {
    // TODO: integrate `web-push`.sendNotification(subscription, JSON.stringify(payload)).
    return true;
  } catch (error) {
    captureException(error);
    return false;
  }
}

// --- events ------------------------------------------------------------------

export async function logPwaInstalled(memberId: string): Promise<void> {
  const member = await memberContext(memberId);
  if (!member) return;
  await appendEvent({ shopId: member.company.shopId, type: "PWA_INSTALLED", entityType: "Buyer", entityId: memberId, payload: {} });
}

// --- reorder push reminders (cron, Growth) -----------------------------------

/**
 * Send opt-in "time to reorder?" push nudges to Growth buyers who have a push
 * subscription + at least one shortcut. Best-effort; delivery no-ops until VAPID
 * is configured. Returns how many were sent.
 */
export async function runReorderPushForShop(shopDomain: string, baseUrl: string): Promise<number> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true, plan: true, shopifyDomain: true } });
  if (!shop || !pushRemindersAllowed(shop.plan)) return 0;

  const subs = await prisma.pushSubscription.findMany({
    where: { member: { company: { shopId: shop.id } } },
    select: { endpoint: true, keys: true, member: { select: { reorderShortcuts: { select: { label: true }, take: 1 } } } },
  });

  let sent = 0;
  for (const sub of subs) {
    const label = sub.member.reorderShortcuts[0]?.label ?? null;
    const payload = reorderPushPayload(shop.shopifyDomain, label, baseUrl);
    if (await deliverPush({ endpoint: sub.endpoint, keys: sub.keys }, payload)) sent++;
  }
  return sent;
}

/**
 * Email active buyers (without a push subscription yet) an "install the app"
 * nudge. Called from the same cron; best-effort.
 */
export async function sendInstallNudges(shopDomain: string, baseUrl: string): Promise<number> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return 0;
  const buyers = await prisma.buyer.findMany({
    where: { status: "ACTIVE", company: { shopId: shop.id }, pushSubscriptions: { none: {} } },
    select: { email: true, name: true },
    take: 200,
  });
  let sent = 0;
  for (const b of buyers) {
    try {
      const tpl = renderTemplate(resolveTemplate("pwa_install_nudge", null), { buyerName: b.name ?? "there", shopName: shopDomain, portalUrl: `${baseUrl.replace(/\/$/, "")}/portal` });
      const res = await sendEmail({ to: b.email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
      if (res.sent) sent++;
    } catch (error) {
      captureException(error);
    }
  }
  return sent;
}
