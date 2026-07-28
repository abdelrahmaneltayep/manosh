import type { SalesRep } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { hashToken, generateMagicToken } from "./magic-link.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { getPlanLimits, evaluateRepSeatAllowance } from "../lib/billing";
import { buildRepLeaderboard, type LeaderboardRow } from "../lib/rep";

/**
 * F12 — Sales-Rep Portal service. Reps authenticate via the same passwordless
 * magic-link mechanism as buyers (token hashed at rest), into a scoped portal
 * that shows only their assigned companies. Growth-only; dark-launched behind
 * MANNON_FF_REP_PORTAL. Strict isolation is enforced by every reader taking the
 * rep's assigned company ids into account (see repCanAccessCompany).
 */

export const REP_PORTAL_ENABLED = () => process.env.MANNON_FF_REP_PORTAL === "true";

const MAGIC_LINK_EXPIRY_DAYS = 7;

export class RepSeatCapError extends Error {
  constructor(public cap: number) {
    super("Rep seat cap reached");
  }
}
export class NotFoundError extends Error {}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

// --- merchant admin ----------------------------------------------------------

export interface RepRow {
  id: string;
  email: string;
  name: string | null;
  status: string;
  assignmentCount: number;
}

export async function listReps(shopDomain: string): Promise<RepRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const reps = await prisma.salesRep.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { assignments: true } } },
  });
  return reps.map((r) => ({ id: r.id, email: r.email, name: r.name, status: r.status, assignmentCount: r._count.assignments }));
}

export async function countReps(shopId: string): Promise<number> {
  return prisma.salesRep.count({ where: { shopId } });
}

/**
 * Invite a rep: create (or reuse) the SalesRep, mint a magic link, record
 * REP_INVITED, and email the invite. Returns the rep + the magic URL (the raw
 * token lives only in that URL). Enforces the plan rep-seat cap.
 */
export async function inviteRep(
  shopDomain: string,
  input: { email: string; name?: string | null },
  plan: string | null,
  baseUrl: string,
  now: Date = new Date(),
): Promise<{ rep: SalesRep; url: string }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new NotFoundError("Unknown shop");

  const email = input.email.trim().toLowerCase();
  const existing = await prisma.salesRep.findUnique({ where: { shopId_email: { shopId, email } }, select: { id: true } });
  if (!existing) {
    const cap = getPlanLimits(plan).repSeatCap;
    const used = await countReps(shopId);
    if (!evaluateRepSeatAllowance(used, cap).allowed) throw new RepSeatCapError(cap);
  }

  const { raw, hash } = generateMagicToken();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const rep = await prisma.salesRep.upsert({
    where: { shopId_email: { shopId, email } },
    create: { shopId, email, name: input.name?.trim() || null, status: "INVITED", magicTokenHash: hash, magicTokenExpiresAt: expiresAt, invitedAt: now },
    update: { name: input.name?.trim() || undefined, magicTokenHash: hash, magicTokenExpiresAt: expiresAt, invitedAt: now },
  });

  const url = new URL("/rep/auth", baseUrl);
  url.searchParams.set("token", raw);

  await appendEvent({
    shopId,
    type: "REP_INVITED",
    entityType: "SalesRep",
    entityId: rep.id,
    payload: { status: rep.status }, // no PII beyond the rep row itself
  });

  const tpl = renderTemplate(resolveTemplate("rep_invite", null), {
    repName: rep.name ?? "there",
    shopName: shopDomain,
    inviteUrl: url.toString(),
  });
  await sendEmail({ to: email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });

  return { rep, url: url.toString() };
}

export async function assignCompany(shopDomain: string, repId: string, companyId: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new NotFoundError("Unknown shop");
  // Both the rep and the company must belong to this shop.
  const [rep, company] = await Promise.all([
    prisma.salesRep.findFirst({ where: { id: repId, shopId }, select: { id: true } }),
    prisma.company.findFirst({ where: { id: companyId, shopId }, select: { id: true } }),
  ]);
  if (!rep || !company) throw new NotFoundError("Rep or company not found");
  await prisma.repAssignment.upsert({
    where: { repId_companyId: { repId, companyId } },
    create: { repId, companyId },
    update: {},
  });
}

export async function unassignCompany(shopDomain: string, repId: string, companyId: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  const rep = await prisma.salesRep.findFirst({ where: { id: repId, shopId }, select: { id: true } });
  if (!rep) return;
  await prisma.repAssignment.deleteMany({ where: { repId, companyId } });
}

export async function removeRep(shopDomain: string, repId: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.salesRep.deleteMany({ where: { id: repId, shopId } });
}

/** Companies available to assign + reps' current assignments (for the admin UI). */
export async function listCompaniesForShop(shopDomain: string): Promise<Array<{ id: string; name: string }>> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  return prisma.company.findMany({ where: { shopId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 });
}

export async function repLeaderboard(shopDomain: string): Promise<LeaderboardRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const [reps, quotes] = await Promise.all([
    prisma.salesRep.findMany({ where: { shopId }, select: { id: true, name: true, email: true } }),
    prisma.quote.findMany({
      where: { placedByRepId: { not: null }, company: { shopId } },
      select: { placedByRepId: true, status: true },
    }),
  ]);
  return buildRepLeaderboard(reps, quotes);
}

// --- rep auth (magic link on the SalesRep row) -------------------------------

export type VerifyResult =
  | { ok: true; rep: SalesRep }
  | { ok: false; reason: "invalid" | "expired" };

/** Verify a rep magic token; with consume:true it's single-use (atomic). */
export async function verifyRepToken(
  rawToken: string | null | undefined,
  options: { consume?: boolean; now?: Date } = {},
): Promise<VerifyResult> {
  if (!rawToken) return { ok: false, reason: "invalid" };
  const now = options.now ?? new Date();
  const hash = hashToken(rawToken);
  const rep = await prisma.salesRep.findFirst({ where: { magicTokenHash: hash } });
  if (!rep || !rep.magicTokenHash || !rep.magicTokenExpiresAt) return { ok: false, reason: "invalid" };
  if (rep.magicTokenExpiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  if (options.consume) {
    const consumed = await prisma.salesRep.updateMany({
      where: { id: rep.id, magicTokenHash: hash, magicTokenExpiresAt: { gt: now } },
      data: { magicTokenHash: null, magicTokenExpiresAt: null, status: "ACTIVE" },
    });
    if (consumed.count !== 1) return { ok: false, reason: "invalid" };
  }
  return { ok: true, rep };
}

// --- rep portal reads (isolation-enforced) -----------------------------------

export async function getRep(repId: string): Promise<SalesRep | null> {
  return prisma.salesRep.findUnique({ where: { id: repId } });
}

export async function getAssignedCompanyIds(repId: string): Promise<string[]> {
  const rows = await prisma.repAssignment.findMany({ where: { repId }, select: { companyId: true } });
  return rows.map((r) => r.companyId);
}

export interface AssignedCompany {
  id: string;
  name: string;
  openQuotes: number;
  memberCount: number;
}

/** The rep's assigned companies with light stats. Only assigned rows — ever. */
export async function listAssignedCompanies(repId: string): Promise<AssignedCompany[]> {
  const rows = await prisma.repAssignment.findMany({
    where: { repId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          _count: { select: { buyers: true } },
          quotes: { where: { status: { in: ["SUBMITTED", "COUNTERED"] } }, select: { id: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.company.id,
    name: r.company.name,
    openQuotes: r.company.quotes.length,
    memberCount: r.company._count.buyers,
  }));
}

/**
 * Load a company for a rep, enforcing isolation: returns null if the company
 * isn't assigned to this rep (caller renders 404). Includes buyers + recent
 * quotes for the order-on-behalf screen.
 */
export async function getRepCompany(repId: string, companyId: string) {
  const assigned = await prisma.repAssignment.findUnique({
    where: { repId_companyId: { repId, companyId } },
    select: { id: true },
  });
  if (!assigned) return null;
  return prisma.company.findUnique({
    where: { id: companyId },
    include: {
      shop: { select: { shopifyDomain: true } },
      buyers: { where: { status: "ACTIVE" }, select: { id: true, email: true, name: true }, orderBy: { createdAt: "asc" } },
      quotes: {
        select: { id: true, status: true, createdAt: true, placedByRepId: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

/**
 * Record that a rep placed a quote/order on behalf of a buyer: the attribution
 * (placedByRepId) is already on the Quote; here we log the audit event (rep +
 * buyer ids) and email the buyer a transparency notice. Best-effort on email.
 */
export async function recordOnBehalf(input: {
  shopId: string;
  shopDomain: string;
  repId: string;
  quoteId: string;
  buyer: { id: string; email: string; name: string | null };
  companyName: string;
}): Promise<void> {
  await appendEvent({
    shopId: input.shopId,
    type: "ORDER_PLACED_ON_BEHALF",
    entityType: "Quote",
    entityId: input.quoteId,
    // ids only — the audit trail is rep + buyer (guardrail #6).
    payload: { repId: input.repId, buyerId: input.buyer.id },
  });
  try {
    const rep = await prisma.salesRep.findUnique({ where: { id: input.repId }, select: { name: true, email: true } });
    const tpl = renderTemplate(resolveTemplate("rep_order_placed", null), {
      buyerName: input.buyer.name ?? "there",
      repName: rep?.name ?? rep?.email ?? "your rep",
      companyName: input.companyName,
      shopName: input.shopDomain,
    });
    await sendEmail({ to: input.buyer.email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
  } catch (error) {
    captureException(error);
  }
}
