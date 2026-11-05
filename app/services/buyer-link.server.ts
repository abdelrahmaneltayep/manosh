import prisma from "../db.server";
import type { AdminGraphqlClient } from "./draft-order.server";

/**
 * Link a Mannon buyer to their native Shopify B2B purchasing entity: the
 * company, the company location they buy for, and their company contact.
 *
 * Shopify owns this relationship (Customers → Companies). A buyer who reaches
 * Mannon through the storefront, wholesale registration or the Buyers page
 * starts unlinked; the merchant adds them as a contact at their company in
 * Shopify, and the next time Mannon needs the link (totals, accept, convert)
 * it reads it here and stores the ids. Read-only against Shopify; nothing is
 * created there. Ids come only from Shopify's response, never fabricated.
 *
 * Fields confirmed against the Admin GraphQL schema via the Shopify Dev MCP
 * (2026-11-05): QueryRoot.customers(query:), Customer.companyContactProfiles
 * [CompanyContact!]!, CompanyContact.company / roleAssignments(first:),
 * CompanyContactRoleAssignment.companyLocation. The email is only used as a
 * search term (an exact phrase query), never read back.
 */
export const BUYER_COMPANY_LINK_QUERY = `#graphql
  query MannonBuyerCompanyLink($q: String!) {
    customers(first: 1, query: $q) {
      nodes {
        id
        companyContactProfiles {
          id
          company { id name }
          roleAssignments(first: 10) { nodes { companyLocation { id name } } }
        }
      }
    }
  }
`;

export interface BuyerCompanyLink {
  companyId: string;
  companyLocationId: string;
  companyContactId: string;
}

export type BuyerLinkProblem = "no-customer" | "not-a-contact" | "other-company" | "no-location" | "unavailable";

export type BuyerLinkResult =
  | { ok: true; link: BuyerCompanyLink; linkedNow: boolean }
  | { ok: false; reason: BuyerLinkProblem; merchantMessage: string; buyerMessage: string };

interface RawLinkData {
  customers?: {
    nodes?: Array<{
      id?: string;
      companyContactProfiles?: Array<{
        id?: string;
        company?: { id?: string; name?: string } | null;
        roleAssignments?: { nodes?: Array<{ companyLocation?: { id?: string; name?: string } | null }> } | null;
      }>;
    }>;
  };
}

const isShopifyCompanyGid = (id: string | null | undefined): id is string => /^gid:\/\/shopify\/Company\/\d+$/.test(id ?? "");

/** Shopify search syntax for an exact email match (quoted phrase, escaped). Pure. */
export function exactEmailQuery(email: string): string {
  return `email:"${email.trim().replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

/**
 * Pick the purchasing entity from the lookup. Prefers the contact profile at
 * `preferredCompanyId` (the quote's company, when it is already a real Shopify
 * company); otherwise the first profile that has a location role. Pure.
 */
export function pickCompanyLink(
  data: RawLinkData | undefined,
  preferredCompanyId: string | null,
): { link: BuyerCompanyLink; companyName: string | null } | { problem: Exclude<BuyerLinkProblem, "unavailable">; companyName?: string | null } {
  const customer = data?.customers?.nodes?.[0];
  if (!customer?.id) return { problem: "no-customer" };
  const profiles = (customer.companyContactProfiles ?? []).filter((p) => p?.id && p.company?.id);
  if (profiles.length === 0) return { problem: "not-a-contact" };
  const locationOf = (p: (typeof profiles)[number]) => p.roleAssignments?.nodes?.find((r) => r?.companyLocation?.id)?.companyLocation ?? null;

  let candidates = profiles;
  if (preferredCompanyId) {
    candidates = profiles.filter((p) => p.company!.id === preferredCompanyId);
    if (candidates.length === 0) return { problem: "other-company", companyName: profiles[0].company?.name ?? null };
  }
  const chosen = candidates.find((p) => locationOf(p)) ?? null;
  if (!chosen) return { problem: "no-location", companyName: candidates[0].company?.name ?? null };
  return {
    link: { companyId: chosen.company!.id!, companyLocationId: locationOf(chosen)!.id!, companyContactId: chosen.id! },
    companyName: chosen.company?.name ?? null,
  };
}

/** Plain-language copy for each problem: what the merchant sets up, and what the buyer reads. Pure. */
export function buyerLinkMessages(
  reason: BuyerLinkProblem,
  email: string,
  companyName?: string | null,
): { merchantMessage: string; buyerMessage: string } {
  const buyerMessage =
    reason === "unavailable"
      ? "We couldn’t reach your supplier’s store just now, so the order wasn’t created. Please try again in a moment."
      : "Your supplier hasn’t finished setting up your company account in Shopify, so an order can’t be created yet. Please contact your supplier.";
  const at = companyName ? ` at ${companyName}` : "";
  const merchantMessage = {
    "no-customer": `Shopify has no customer with ${email}. In Shopify, add them as a contact at their company (Customers → Companies), then try again.`,
    "not-a-contact": `${email} isn’t a contact at any company in Shopify yet. Add them to their company in Customers → Companies, then try again.`,
    "other-company": `${email} is a contact at a different company in Shopify${at} than this buyer’s company in Mannon. Add them to the right company in Customers → Companies, then try again.`,
    "no-location": `${email} is a contact${at} but has no location role. Assign them a location in Customers → Companies, then try again.`,
    unavailable: "Shopify’s company details aren’t available right now. Try again in a moment.",
  }[reason];
  return { merchantMessage, buyerMessage };
}

/**
 * The buyer's purchasing entity, reading Shopify when the buyer isn't linked
 * yet. A buyer already linked to a real Shopify company costs no API call.
 * Saves the contact + location on the buyer, and replaces a placeholder
 * company id (e.g. `quote-request:…`, `wholesale:…`) with the real Shopify
 * company id when no other company row in the shop already holds it.
 */
export async function ensureBuyerCompanyLink(admin: AdminGraphqlClient, buyerId: string): Promise<BuyerLinkResult> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { id: true, email: true, shopifyContactId: true, shopifyCompanyLocationId: true, company: { select: { id: true, shopId: true, shopifyCompanyId: true } } },
  });
  if (!buyer) return { ok: false, reason: "no-customer", ...buyerLinkMessages("no-customer", "this buyer") };
  const knownCompany = isShopifyCompanyGid(buyer.company.shopifyCompanyId) ? buyer.company.shopifyCompanyId : null;

  if (knownCompany && buyer.shopifyContactId && buyer.shopifyCompanyLocationId) {
    return { ok: true, linkedNow: false, link: { companyId: knownCompany, companyLocationId: buyer.shopifyCompanyLocationId, companyContactId: buyer.shopifyContactId } };
  }

  let data: RawLinkData | undefined;
  try {
    const response = await admin.graphql(BUYER_COMPANY_LINK_QUERY, { variables: { q: exactEmailQuery(buyer.email) } });
    const body = (await response.json()) as { data?: RawLinkData; errors?: unknown };
    if (body.errors && !body.data) throw new Error(JSON.stringify(body.errors).slice(0, 300));
    data = body.data;
  } catch (error) {
    console.error("[buyer-link] Shopify lookup failed for buyer %s:", buyerId, error);
    return { ok: false, reason: "unavailable", ...buyerLinkMessages("unavailable", buyer.email) };
  }

  const picked = pickCompanyLink(data, knownCompany);
  if ("problem" in picked) return { ok: false, reason: picked.problem, ...buyerLinkMessages(picked.problem, buyer.email, picked.companyName) };
  const { link } = picked;

  await prisma.buyer.update({
    where: { id: buyer.id },
    data: { shopifyContactId: link.companyContactId, shopifyCompanyLocationId: link.companyLocationId },
  });
  if (!knownCompany) {
    const taken = await prisma.company.findFirst({ where: { shopId: buyer.company.shopId, shopifyCompanyId: link.companyId }, select: { id: true } });
    if (!taken) {
      await prisma.company.update({ where: { id: buyer.company.id }, data: { shopifyCompanyId: link.companyId } }).catch((error) => {
        console.warn("[buyer-link] kept the placeholder company id for %s:", buyer.company.id, error);
      });
    }
  }
  return { ok: true, linkedNow: true, link };
}
