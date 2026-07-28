import type { TaxIdType as PrismaTaxIdType } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { captureException } from "../lib/sentry.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import { compliantInvoiceNumbering, taxCertWorkflowAllowed } from "../lib/billing";
import {
  resolveTaxTreatment,
  certificateExpiringSoon,
  formatInvoiceNumber,
  type TaxIdType,
  type TaxProfileLite,
  type TaxTreatment,
} from "../lib/tax";

/**
 * F14 — Tax Exemption & VAT/GST service. Mannon NEVER computes tax (guardrail #1);
 * Shopify does. This service stores tax profiles + certificates (privately),
 * verifies them, and decides the taxExempt FLAG passed to the draft order. It
 * defaults to charging tax until a profile is VERIFIED. Dark-launched behind
 * MANNON_FF_TAX_VAT.
 */

export const TAX_VAT_ENABLED = () => process.env.MANNON_FF_TAX_VAT === "true";

const MAX_CERT_BYTES = 5 * 1024 * 1024; // 5 MB cap on a stored certificate

export class NotFoundError extends Error {}
export class CertTooLargeError extends Error {}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

async function assertCompanyInShop(shopDomain: string, companyId: string): Promise<void> {
  const c = await prisma.company.findFirst({ where: { id: companyId, shop: { shopifyDomain: shopDomain } }, select: { id: true } });
  if (!c) throw new NotFoundError("Company not found");
}

// --- buyer submission --------------------------------------------------------

export interface CertInput {
  name: string;
  type: string;
  data: Uint8Array<ArrayBuffer>;
  expiresAt?: Date | null;
}

/**
 * Buyer submits a tax id and/or an exemption certificate. Always lands as
 * UNVERIFIED + not exempt — an upload never auto-exempts (the guardrail). Emails
 * the buyer an acknowledgement.
 */
export async function submitTaxProfile(
  companyId: string,
  input: { taxId?: string | null; taxIdType?: TaxIdType; cert?: CertInput | null; wantsExempt?: boolean },
): Promise<void> {
  if (input.cert && input.cert.data.length > MAX_CERT_BYTES) throw new CertTooLargeError("Certificate too large");

  const data = {
    taxId: input.taxId?.trim() || null,
    taxIdType: (input.taxIdType ?? "OTHER") as PrismaTaxIdType,
    // Store the buyer's exemption REQUEST but keep them taxed until verified.
    exempt: false,
    status: "UNVERIFIED" as const,
    verifiedAt: null,
    rejectedReason: null,
    certExpiryRemindedAt: null,
    ...(input.cert
      ? { certificateName: input.cert.name, certificateType: input.cert.type, certificateData: input.cert.data, certificateExpiresAt: input.cert.expiresAt ?? null }
      : {}),
  };

  await prisma.taxProfile.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  });

  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, shop: { select: { shopifyDomain: true } }, buyers: { where: { status: "ACTIVE" }, select: { email: true, name: true }, take: 1 } },
    });
    const buyer = company?.buyers[0];
    if (buyer) {
      const tpl = renderTemplate(resolveTemplate("tax_certificate_received", null), { buyerName: buyer.name ?? "there", companyName: company!.name, shopName: company!.shop.shopifyDomain });
      await sendEmail({ to: buyer.email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
    }
  } catch (error) {
    captureException(error);
  }
}

// --- merchant review ---------------------------------------------------------

export interface ProfileView {
  companyId: string;
  companyName: string;
  taxId: string | null;
  taxIdType: string;
  exempt: boolean;
  status: string;
  hasCertificate: boolean;
  certificateExpiresAt: Date | null;
  verifiedAt: Date | null;
}

export async function getTaxProfile(shopDomain: string, companyId: string): Promise<ProfileView | null> {
  const p = await prisma.taxProfile.findFirst({
    where: { companyId, company: { shop: { shopifyDomain: shopDomain } } },
    include: { company: { select: { name: true } } },
  });
  if (!p) return null;
  return {
    companyId: p.companyId,
    companyName: p.company.name,
    taxId: p.taxId,
    taxIdType: p.taxIdType,
    exempt: p.exempt,
    status: p.status,
    hasCertificate: p.certificateData != null,
    certificateExpiresAt: p.certificateExpiresAt,
    verifiedAt: p.verifiedAt,
  };
}

export async function listProfilesForShop(shopDomain: string): Promise<ProfileView[]> {
  const rows = await prisma.taxProfile.findMany({
    where: { company: { shop: { shopifyDomain: shopDomain } } },
    include: { company: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map((p) => ({
    companyId: p.companyId,
    companyName: p.company.name,
    taxId: p.taxId,
    taxIdType: p.taxIdType,
    exempt: p.exempt,
    status: p.status,
    hasCertificate: p.certificateData != null,
    certificateExpiresAt: p.certificateExpiresAt,
    verifiedAt: p.verifiedAt,
  }));
}

/** Merchant verifies a profile (Growth workflow). `exempt` sets the treatment. */
export async function verifyTaxProfile(shopDomain: string, companyId: string, exempt: boolean, now: Date = new Date()): Promise<void> {
  await assertCompanyInShop(shopDomain, companyId);
  const shopId = await shopIdFor(shopDomain);
  const profile = await prisma.taxProfile.findUnique({ where: { companyId }, select: { id: true } });
  if (!profile) throw new NotFoundError("No tax profile to verify");
  await prisma.taxProfile.update({ where: { companyId }, data: { status: "VERIFIED", exempt, verifiedAt: now, rejectedReason: null } });

  if (shopId) {
    await appendEvent({ shopId, type: "TAX_PROFILE_VERIFIED", entityType: "Company", entityId: companyId, payload: { exempt } });
  }
  await emailBuyer(companyId, "tax_verified", { status: exempt ? "exempt" : "taxable" });
}

export async function rejectTaxProfile(shopDomain: string, companyId: string, reason: string): Promise<void> {
  await assertCompanyInShop(shopDomain, companyId);
  await prisma.taxProfile.update({ where: { companyId }, data: { status: "REJECTED", exempt: false, rejectedReason: reason || null } });
  await emailBuyer(companyId, "tax_rejected", { reason: reason || "Please re-submit valid documents." });
}

/**
 * Starter "basic" path: a manual exempt toggle per company with no certificate
 * workflow. Sets a VERIFIED (manual) treatment directly.
 */
export async function setManualExempt(shopDomain: string, companyId: string, exempt: boolean, now: Date = new Date()): Promise<void> {
  await assertCompanyInShop(shopDomain, companyId);
  await prisma.taxProfile.upsert({
    where: { companyId },
    create: { companyId, exempt, status: "VERIFIED", verifiedAt: now, taxIdType: "OTHER" },
    update: { exempt, status: "VERIFIED", verifiedAt: now },
  });
}

/** Private certificate download — ownership-checked; never a public URL. */
export async function getCertificate(shopDomain: string, companyId: string): Promise<{ name: string; type: string; data: Uint8Array<ArrayBuffer> } | null> {
  const p = await prisma.taxProfile.findFirst({
    where: { companyId, company: { shop: { shopifyDomain: shopDomain } } },
    select: { certificateName: true, certificateType: true, certificateData: true },
  });
  if (!p || !p.certificateData) return null;
  return { name: p.certificateName ?? "certificate", type: p.certificateType ?? "application/octet-stream", data: new Uint8Array(p.certificateData) as Uint8Array<ArrayBuffer> };
}

// --- region rules + default rate (Growth / basic) ----------------------------

export interface RegionRuleRow {
  id: string;
  region: string;
  rate: string | null;
  exemptByDefault: boolean;
}

export async function listRegionRules(shopDomain: string): Promise<RegionRuleRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.taxRuleOverride.findMany({ where: { shopId }, orderBy: { region: "asc" } });
  return rows.map((r) => ({ id: r.id, region: r.region, rate: r.rate?.toString() ?? null, exemptByDefault: r.exemptByDefault }));
}

export async function upsertRegionRule(shopDomain: string, input: { region: string; rate?: number | null; exemptByDefault: boolean }): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) throw new NotFoundError("Unknown shop");
  const region = input.region.trim().toUpperCase();
  await prisma.taxRuleOverride.upsert({
    where: { shopId_region: { shopId, region } },
    create: { shopId, region, rate: input.rate != null ? input.rate.toFixed(4) : null, exemptByDefault: input.exemptByDefault },
    update: { rate: input.rate != null ? input.rate.toFixed(4) : null, exemptByDefault: input.exemptByDefault },
  });
}

export async function deleteRegionRule(shopDomain: string, id: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.taxRuleOverride.deleteMany({ where: { id, shopId } });
}

export async function getDefaultTaxRate(shopDomain: string): Promise<number | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { defaultTaxRate: true } });
  return shop?.defaultTaxRate ?? null;
}

export async function setDefaultTaxRate(shopDomain: string, rate: number | null): Promise<void> {
  await prisma.shop.update({ where: { shopifyDomain: shopDomain }, data: { defaultTaxRate: rate } });
}

// --- treatment (used by the draft-order path + display) ----------------------

/** The tax treatment for a company's order. Flag off / no profile → taxed. */
export async function getTaxTreatment(companyId: string): Promise<TaxTreatment> {
  if (!TAX_VAT_ENABLED()) return { taxExempt: false, reason: "feature-off", displayStatus: "Taxed" };
  const p = await prisma.taxProfile.findUnique({ where: { companyId }, select: { status: true, exempt: true } });
  const profile: TaxProfileLite | null = p ? { status: p.status, exempt: p.exempt } : null;
  // Region rules require the company's billing region (a Shopify Admin read) —
  // a documented follow-up; profile-level treatment fully drives exemption today.
  return resolveTaxTreatment(profile, null);
}

/** Convenience for the draft-order builder. */
export async function isCompanyTaxExempt(companyId: string): Promise<boolean> {
  return (await getTaxTreatment(companyId)).taxExempt;
}

// --- compliant invoice numbering ---------------------------------------------

/**
 * Atomically allocate the next compliant invoice sequence number for a shop
 * (Growth). Returns null when numbering isn't enabled for the plan/flag.
 */
export async function allocateInvoiceNumber(shopId: string, plan: string | null): Promise<{ sequenceNo: number; formatted: string } | null> {
  if (!TAX_VAT_ENABLED() || !compliantInvoiceNumbering(plan)) return null;
  const shop = await prisma.shop.update({ where: { id: shopId }, data: { invoiceSeq: { increment: 1 } }, select: { invoiceSeq: true } });
  return { sequenceNo: shop.invoiceSeq, formatted: formatInvoiceNumber(shop.invoiceSeq) };
}

// --- cert expiry reminders (cron) --------------------------------------------

export async function runCertExpiryRemindersForShop(shopDomain: string, now: Date = new Date()): Promise<number> {
  const profiles = await prisma.taxProfile.findMany({
    where: {
      status: "VERIFIED",
      certificateExpiresAt: { not: null },
      company: { shop: { shopifyDomain: shopDomain } },
    },
    include: { company: { select: { name: true, buyers: { where: { status: "ACTIVE" }, select: { email: true, name: true }, take: 1 } } } },
  });

  let sent = 0;
  for (const p of profiles) {
    if (!certificateExpiringSoon(p.certificateExpiresAt, now, 30)) continue;
    // Idempotent: skip if we already reminded within this expiry window.
    if (p.certExpiryRemindedAt && p.certExpiryRemindedAt.getTime() > now.getTime() - 30 * 86400000) continue;
    const buyer = p.company.buyers[0];
    if (buyer) {
      const tpl = renderTemplate(resolveTemplate("tax_cert_expiring", null), {
        buyerName: buyer.name ?? "there",
        companyName: p.company.name,
        expiresAt: p.certificateExpiresAt!.toISOString().slice(0, 10),
        shopName: shopDomain,
      });
      await sendEmail({ to: buyer.email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
    }
    await prisma.taxProfile.update({ where: { id: p.id }, data: { certExpiryRemindedAt: now } });
    sent++;
  }
  return sent;
}

// --- helpers -----------------------------------------------------------------

async function emailBuyer(companyId: string, templateKey: string, extra: Record<string, string>): Promise<void> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, shop: { select: { shopifyDomain: true } }, buyers: { where: { status: "ACTIVE" }, select: { email: true, name: true }, take: 1 } },
    });
    const buyer = company?.buyers[0];
    if (!buyer) return;
    const tpl = renderTemplate(resolveTemplate(templateKey as never, null), { buyerName: buyer.name ?? "there", companyName: company!.name, shopName: company!.shop.shopifyDomain, ...extra });
    await sendEmail({ to: buyer.email, subject: tpl.subject, html: tpl.body.replace(/\n/g, "<br>"), text: tpl.body });
  } catch (error) {
    captureException(error);
  }
}

export { taxCertWorkflowAllowed };
