import { createHmac } from "node:crypto";
import type { FollowupKind } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { expireQuote } from "./quote.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { getPlanLimits } from "../lib/billing";
import {
  computeSchedule,
  isBusinessHours,
  DEFAULT_POLICY,
  type FollowupPolicy,
} from "../lib/followups";

/**
 * F8 — automated follow-ups. Reuses the quote status machine (expireQuote) and
 * the F2 mailer. Scheduling is idempotent and self-heals from the cron, so quotes
 * always have the right nudges even if a call site is missed.
 */

const ACTIVE: Array<"SUBMITTED" | "COUNTERED"> = ["SUBMITTED", "COUNTERED"];

function tokenSecret(): string {
  return process.env.SHOPIFY_API_SECRET || process.env.SESSION_SECRET || "mannon-dev";
}
/** Signed unsubscribe token for a quote (no login needed from the email). */
export function unsubscribeToken(quoteId: string): string {
  return createHmac("sha256", tokenSecret()).update(quoteId).digest("hex").slice(0, 32);
}
export function verifyUnsubscribeToken(quoteId: string, token: string): boolean {
  const expected = unsubscribeToken(quoteId);
  return token.length === expected.length && token === expected;
}

// --- policy ------------------------------------------------------------------

export async function getPolicy(shopDomain: string): Promise<FollowupPolicy & { planMax: number }> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, plan: true, followupPolicy: true },
  });
  const planMax = getPlanLimits(shop?.plan).followupCadenceMax;
  const p = shop?.followupPolicy;
  return {
    enabled: p?.enabled ?? DEFAULT_POLICY.enabled,
    expiryDays: p?.expiryDays ?? DEFAULT_POLICY.expiryDays,
    cadenceDays: p?.cadenceDays ?? DEFAULT_POLICY.cadenceDays,
    maxNudges: p?.maxNudges ?? DEFAULT_POLICY.maxNudges,
    planMax,
  };
}

export async function upsertPolicy(
  shopDomain: string,
  input: { enabled: boolean; expiryDays: number; cadenceDays: number[]; maxNudges: number },
): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return;
  await prisma.followupPolicy.upsert({
    where: { shopId: shop.id },
    create: { shopId: shop.id, ...input },
    update: input,
  });
}

// --- scheduling --------------------------------------------------------------

/** (Re)build the SCHEDULED follow-ups for a quote from the shop policy. */
export async function scheduleForQuote(quoteId: string): Promise<void> {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { company: { include: { shop: { select: { shopifyDomain: true, plan: true } } } } },
  });
  if (!quote || !ACTIVE.includes(quote.status as "SUBMITTED" | "COUNTERED")) return;

  const policy = await getPolicy(quote.company.shop.shopifyDomain);
  // Clear existing scheduled rows, then rebuild.
  await prisma.quoteFollowup.deleteMany({ where: { quoteId, status: "SCHEDULED" } });
  if (!policy.enabled) return;

  const items = computeSchedule(quote.createdAt, quote.expiresAt, policy, policy.planMax);
  if (items.length === 0) return;
  await prisma.quoteFollowup.createMany({
    data: items.map((i) => ({ quoteId, kind: i.kind as FollowupKind, scheduledFor: i.scheduledFor })),
  });
}

/** Cancel a quote's remaining scheduled follow-ups (on accept / reject). */
export async function cancelForQuote(quoteId: string): Promise<void> {
  await prisma.quoteFollowup.updateMany({
    where: { quoteId, status: "SCHEDULED" },
    data: { status: "CANCELLED" },
  });
}

// --- dispatch ----------------------------------------------------------------

function isUnsubscribed(reminderState: unknown): boolean {
  return Boolean((reminderState as { unsubscribed?: boolean } | null)?.unsubscribed);
}

export interface DispatchResult {
  sent: number;
  expired: number;
  skipped: number;
}

/**
 * Dispatch all due follow-ups for a shop. Reminders/warnings email the buyer with
 * accept/counter deep-links (respecting quiet hours + unsubscribe + maxNudges);
 * EXPIRED transitions the quote and cancels the rest. `now` is injectable.
 */
export async function dispatchForShop(shopDomain: string, baseUrl: string, now: Date = new Date()): Promise<DispatchResult> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, timezone: true, emailTemplates: true },
  });
  if (!shop) return { sent: 0, expired: 0, skipped: 0 };
  const businessHoursOk = isBusinessHours(now, shop.timezone);

  const due = await prisma.quoteFollowup.findMany({
    where: {
      status: "SCHEDULED",
      scheduledFor: { lte: now },
      quote: { company: { shopId: shop.id } },
    },
    include: { quote: { include: { buyer: { select: { email: true, name: true } } } } },
    orderBy: { scheduledFor: "asc" },
  });

  let sent = 0;
  let expired = 0;
  let skipped = 0;

  for (const f of due) {
    const quote = f.quote;
    // Terminal quote → nothing to do; cancel this leftover.
    if (!ACTIVE.includes(quote.status as "SUBMITTED" | "COUNTERED") && f.kind !== "EXPIRED") {
      await prisma.quoteFollowup.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
      continue;
    }

    if (f.kind === "EXPIRED") {
      if (ACTIVE.includes(quote.status as "SUBMITTED" | "COUNTERED")) {
        await expireQuote(quote.id).catch(() => undefined);
        expired++;
      }
      await prisma.quoteFollowup.update({ where: { id: f.id }, data: { status: "SENT", sentAt: now } });
      await cancelForQuote(quote.id);
      continue;
    }

    // Reminder / expiry warning.
    if (isUnsubscribed(quote.reminderState) || !businessHoursOk) {
      skipped++;
      continue; // leave SCHEDULED; a later run in-hours picks it up
    }
    // Never exceed maxNudges.
    const nudgesSent = await prisma.quoteFollowup.count({
      where: { quoteId: quote.id, kind: "REMINDER", status: "SENT" },
    });
    const policy = await getPolicy(shopDomain);
    if (f.kind === "REMINDER" && nudgesSent >= policy.maxNudges) {
      await prisma.quoteFollowup.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
      continue;
    }

    const key = f.kind === "EXPIRY_WARNING" ? "followup_expiry_warning" : "followup_reminder";
    const template = resolveTemplate(key, shop.emailTemplates);
    const { subject, body } = renderTemplate(template, {
      buyerName: quote.buyer.name ?? "there",
      quoteUrl: `${baseUrl}/portal/quotes/${quote.id}`,
      expiresAt: quote.expiresAt.toISOString().slice(0, 10),
      unsubscribeUrl: `${baseUrl}/portal/unsubscribe/${quote.id}?t=${unsubscribeToken(quote.id)}`,
      shopName: shopDomain,
    });
    await sendEmail({ to: quote.buyer.email, subject, html: body, text: body });
    await prisma.quoteFollowup.update({ where: { id: f.id }, data: { status: "SENT", sentAt: now } });
    await appendEvent({
      shopId: shop.id,
      type: "FOLLOWUP_SENT",
      entityType: "Quote",
      entityId: quote.id,
      payload: { kind: f.kind },
    });
    sent++;
  }

  return { sent, expired, skipped };
}

/** Ensure active quotes have a schedule and terminal ones are cancelled. */
export async function reconcileScheduleForShop(shopDomain: string): Promise<void> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  if (!shop) return;
  const quotes = await prisma.quote.findMany({
    where: { company: { shopId: shop.id } },
    select: { id: true, status: true, _count: { select: { followups: true } } },
  });
  for (const q of quotes) {
    if (ACTIVE.includes(q.status as "SUBMITTED" | "COUNTERED")) {
      const scheduled = await prisma.quoteFollowup.count({ where: { quoteId: q.id, status: "SCHEDULED" } });
      if (scheduled === 0) await scheduleForQuote(q.id);
    } else {
      await cancelForQuote(q.id);
    }
  }
}

// --- merchant helpers --------------------------------------------------------

export interface NeedsNudgeRow {
  id: string;
  companyName: string;
  expiresAt: Date;
  nextFollowup: Date | null;
  overdue: boolean;
}

export async function needsNudgeList(shopDomain: string, now: Date = new Date()): Promise<NeedsNudgeRow[]> {
  const rows = await prisma.quote.findMany({
    where: { company: { shop: { shopifyDomain: shopDomain } }, status: { in: ACTIVE } },
    include: {
      company: { select: { name: true } },
      followups: { where: { status: "SCHEDULED" }, orderBy: { scheduledFor: "asc" }, take: 1 },
    },
    orderBy: { expiresAt: "asc" },
  });
  return rows.map((q) => ({
    id: q.id,
    companyName: q.company.name,
    expiresAt: q.expiresAt,
    nextFollowup: q.followups[0]?.scheduledFor ?? null,
    overdue: q.followups[0] ? q.followups[0].scheduledFor.getTime() <= now.getTime() : false,
  }));
}

/**
 * Manual "send now" — dispatch the earliest scheduled reminder for a quote.
 * When `customBody` is provided (e.g. a Claude-drafted, merchant-reviewed
 * message), it replaces the template body; the quote link + unsubscribe footer
 * are always appended so the send stays actionable and compliant.
 */
export async function sendNow(
  shopDomain: string,
  quoteId: string,
  baseUrl: string,
  options: { now?: Date; customBody?: string } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const owned = await prisma.quote.findFirst({
    where: { id: quoteId, company: { shop: { shopifyDomain: shopDomain } } },
    include: { company: { include: { shop: { select: { id: true, emailTemplates: true } } } }, buyer: { select: { email: true, name: true } } },
  });
  if (!owned || !ACTIVE.includes(owned.status as "SUBMITTED" | "COUNTERED")) return false;

  const quoteUrl = `${baseUrl}/portal/quotes/${owned.id}`;
  const unsubscribeUrl = `${baseUrl}/portal/unsubscribe/${owned.id}?t=${unsubscribeToken(owned.id)}`;
  const template = resolveTemplate("followup_reminder", owned.company.shop.emailTemplates);
  const rendered = renderTemplate(template, {
    buyerName: owned.buyer.name ?? "there",
    quoteUrl,
    expiresAt: owned.expiresAt.toISOString().slice(0, 10),
    unsubscribeUrl,
    shopName: shopDomain,
  });
  const custom = options.customBody?.trim();
  const subject = rendered.subject;
  const body = custom
    ? `${custom}\n\nView your quote: ${quoteUrl}\n\nTo stop these reminders: ${unsubscribeUrl}`
    : rendered.body;
  await sendEmail({ to: owned.buyer.email, subject, html: body, text: body });

  // Mark the earliest scheduled reminder as sent (so the cadence advances).
  const next = await prisma.quoteFollowup.findFirst({
    where: { quoteId, status: "SCHEDULED", kind: "REMINDER" },
    orderBy: { scheduledFor: "asc" },
  });
  if (next) await prisma.quoteFollowup.update({ where: { id: next.id }, data: { status: "SENT", sentAt: now } });

  await appendEvent({
    shopId: owned.company.shop.id,
    type: "FOLLOWUP_SENT",
    entityType: "Quote",
    entityId: quoteId,
    payload: { kind: "REMINDER", manual: true },
  });
  return true;
}

/** Buyer unsubscribe (from an email link): stop nudges for this quote. */
export async function unsubscribeQuote(quoteId: string): Promise<void> {
  await prisma.quote.update({
    where: { id: quoteId },
    data: { reminderState: { unsubscribed: true } },
  });
  await cancelForQuote(quoteId);
}
