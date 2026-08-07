import type { WholesaleFieldType, WholesaleStatus } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { issueMagicLink } from "./magic-link.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";
import {
  shouldAutoApprove,
  validateSubmission,
  isHoneypotTripped,
  type FieldSpec,
} from "../lib/wholesale";

/**
 * F6 — wholesale registration. Merchant builds a form; a public URL collects
 * applications; a queue approves them (manual or auto). On approve we provision
 * an F5 Company + admin member (magic link) and assign the F3 default price list.
 */

export class WholesaleFormCapError extends Error {
  constructor(public cap: number) {
    super(`Wholesale form limit reached (${cap}).`);
    this.name = "WholesaleFormCapError";
  }
}
export class NotFoundError extends Error {
  constructor() {
    super("Not found.");
    this.name = "WholesaleNotFoundError";
  }
}

async function shopFor(shopDomain: string) {
  return prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, plan: true, emailTemplates: true },
  });
}

// --- forms -------------------------------------------------------------------

export async function listForms(shopDomain: string) {
  const forms = await prisma.wholesaleForm.findMany({
    where: { shop: { shopifyDomain: shopDomain } },
    include: { _count: { select: { fields: true, applications: true } } },
    orderBy: { createdAt: "asc" },
  });
  return forms.map((f) => ({
    id: f.id,
    name: f.name,
    published: f.published,
    isDefault: f.isDefault,
    fieldCount: f._count.fields,
    applicationCount: f._count.applications,
  }));
}

/** Create a form, enforcing the plan cap. First form becomes the default. */
export async function createForm(shopDomain: string, name: string, cap: number) {
  const shop = await shopFor(shopDomain);
  if (!shop) throw new NotFoundError();
  const count = await prisma.wholesaleForm.count({ where: { shopId: shop.id } });
  if (count >= cap) throw new WholesaleFormCapError(cap);
  const form = await prisma.wholesaleForm.create({
    data: {
      shopId: shop.id,
      name: name.trim() || "Wholesale application",
      isDefault: count === 0,
      autoApproveDomains: [],
      fields: {
        create: [
          { label: "Company name", key: "company_name", type: "TEXT", required: true, order: 0 },
          { label: "Contact email", key: "contact_email", type: "EMAIL", required: true, order: 1 },
          { label: "Website", key: "website", type: "TEXT", required: false, order: 2 },
        ],
      },
    },
    select: { id: true },
  });
  return form;
}

export async function getForm(shopDomain: string, formId: string) {
  const form = await prisma.wholesaleForm.findFirst({
    where: { id: formId, shop: { shopifyDomain: shopDomain } },
    include: { fields: { orderBy: { order: "asc" } } },
  });
  return form;
}

export async function saveField(
  shopDomain: string,
  formId: string,
  input: { id?: string; label: string; key: string; type: WholesaleFieldType; required: boolean; options?: string[] },
) {
  const form = await getForm(shopDomain, formId);
  if (!form) throw new NotFoundError();
  const order = form.fields.length;
  if (input.id) {
    await prisma.wholesaleFormField.updateMany({
      where: { id: input.id, formId },
      data: {
        label: input.label,
        type: input.type,
        required: input.required,
        options: input.options ?? undefined,
      },
    });
  } else {
    await prisma.wholesaleFormField.create({
      data: {
        formId,
        label: input.label,
        key: input.key,
        type: input.type,
        required: input.required,
        options: input.options ?? undefined,
        order,
      },
    });
  }
}

export async function deleteField(shopDomain: string, formId: string, fieldId: string) {
  const form = await getForm(shopDomain, formId);
  if (!form) throw new NotFoundError();
  await prisma.wholesaleFormField.deleteMany({ where: { id: fieldId, formId } });
}

export async function updateFormSettings(
  shopDomain: string,
  formId: string,
  input: { published?: boolean; autoApproveDomains?: string[] },
) {
  const form = await getForm(shopDomain, formId);
  if (!form) throw new NotFoundError();
  await prisma.wholesaleForm.updateMany({
    where: { id: formId },
    data: {
      published: input.published,
      autoApproveDomains: input.autoApproveDomains,
    },
  });
}

// --- public form + submission ------------------------------------------------

export async function getPublicForm(shopDomain: string) {
  return prisma.wholesaleForm.findFirst({
    where: { shop: { shopifyDomain: shopDomain }, published: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { fields: { orderBy: { order: "asc" } } },
  });
}

// Simple in-memory rate limit: max submissions per key per window.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const submissions = new Map<string, number[]>();
export function submitRateOk(key: string, now: number): boolean {
  const arr = (submissions.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    submissions.set(key, arr);
    return false;
  }
  arr.push(now);
  submissions.set(key, arr);
  return true;
}
export function resetSubmitRate() {
  submissions.clear();
}

export type SubmitResult =
  | { ok: true; status: WholesaleStatus }
  | { ok: false; error: string; fieldErrors?: string[] };

export async function submitApplication(
  shopDomain: string,
  payload: {
    values: Record<string, string | undefined>;
    honeypot: unknown;
    rateKey: string;
    baseUrl: string;
    now?: number;
  },
): Promise<SubmitResult> {
  const now = payload.now ?? Date.now();

  // Honeypot: pretend success, create nothing.
  if (isHoneypotTripped(payload.honeypot)) return { ok: true, status: "PENDING" };

  if (!submitRateOk(payload.rateKey, now)) {
    return { ok: false, error: "Too many submissions right now. Please try again in a minute." };
  }

  const shop = await shopFor(shopDomain);
  if (!shop) return { ok: false, error: "This store isn’t accepting applications." };

  const form = await getPublicForm(shopDomain);
  if (!form) return { ok: false, error: "This store isn’t accepting applications yet." };

  const specs: FieldSpec[] = form.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
  }));
  const validation = validateSubmission(specs, payload.values);
  if (!validation.ok) return { ok: false, error: "Please fix the form.", fieldErrors: validation.errors };

  const companyName = (payload.values.company_name ?? payload.values.company ?? "").trim() || "Applicant";
  const contactEmail = (payload.values.contact_email ?? payload.values.email ?? "").trim().toLowerCase();
  if (!contactEmail) return { ok: false, error: "A contact email is required." };

  // Dedupe by email while an application is open/approved.
  const existing = await prisma.wholesaleApplication.findFirst({
    where: { shopId: shop.id, contactEmail, status: { in: ["PENDING", "APPROVED", "MORE_INFO"] } },
  });
  if (existing) {
    return { ok: true, status: existing.status };
  }

  const application = await prisma.wholesaleApplication.create({
    data: {
      shopId: shop.id,
      formId: form.id,
      companyName,
      contactEmail,
      phone: payload.values.phone ?? null,
      taxId: payload.values.tax_id ?? payload.values.taxId ?? null,
      website: payload.values.website ?? null,
      answers: payload.values as object,
      status: "PENDING",
      tags: [],
    },
  });

  // Auto-approve (Growth only) when the domain is allowlisted.
  let status: WholesaleStatus = "PENDING";
  if (shop.plan === "GROWTH" && shouldAutoApprove(contactEmail, form.autoApproveDomains)) {
    await provisionApproval(application.id, shopDomain, "auto", payload.baseUrl);
    status = "APPROVED";
  }

  // Buyer-facing "application received" (best-effort).
  const received = resolveTemplate("application_received", shop.emailTemplates);
  const { subject, body } = renderTemplate(received, {
    companyName,
    shopName: shopDomain,
  });
  await sendEmail({ to: contactEmail, subject, html: body, text: body });

  return { ok: true, status };
}

// --- queue + decisions -------------------------------------------------------

export interface ApplicationRow {
  id: string;
  companyName: string;
  contactEmail: string;
  status: WholesaleStatus;
  createdAt: Date;
}

export async function listApplications(shopDomain: string, status?: WholesaleStatus): Promise<ApplicationRow[]> {
  const rows = await prisma.wholesaleApplication.findMany({
    where: { shop: { shopifyDomain: shopDomain }, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, companyName: true, contactEmail: true, status: true, createdAt: true },
  });
  return rows;
}

export async function getApplication(shopDomain: string, id: string) {
  return prisma.wholesaleApplication.findFirst({
    where: { id, shop: { shopifyDomain: shopDomain } },
  });
}

/**
 * Provision an approved application: create the F5 Company + admin member with a
 * magic link, assign the F3 default price list, tag it, and mark approved.
 * Returns the magic link so the caller can email it.
 */
export async function provisionApproval(
  applicationId: string,
  shopDomain: string,
  reviewedBy: string,
  baseUrl: string,
): Promise<{ magicUrl: string } | null> {
  const shop = await shopFor(shopDomain);
  if (!shop) return null;
  const app = await prisma.wholesaleApplication.findFirst({ where: { id: applicationId, shopId: shop.id } });
  if (!app) return null;
  if (app.companyId) {
    // already provisioned
    return null;
  }

  // Reuse F5 Company. No native Shopify company yet, so use a stable placeholder
  // GID; a later slice can reconcile to a real gid://shopify/Company on first order.
  const company = await prisma.company.create({
    data: {
      shopId: shop.id,
      shopifyCompanyId: `wholesale:${app.id}`,
      name: app.companyName,
    },
    select: { id: true },
  });

  const buyer = await prisma.buyer.create({
    data: {
      companyId: company.id,
      email: app.contactEmail,
      role: "ADMIN",
      status: "INVITED",
      invitedAt: new Date(),
    },
    select: { id: true },
  });
  const { url } = await issueMagicLink(buyer.id, { baseUrl });

  // Assign the shop's default price list (F3), if one exists.
  const defaultList = await prisma.priceList.findFirst({
    where: { shopId: shop.id, isDefault: true },
    select: { id: true },
  });
  if (defaultList) {
    await prisma.companyPriceList.upsert({
      where: { companyId: company.id },
      create: { companyId: company.id, priceListId: defaultList.id },
      update: { priceListId: defaultList.id },
    });
  }

  await prisma.wholesaleApplication.update({
    where: { id: app.id },
    data: {
      status: "APPROVED",
      companyId: company.id,
      tags: Array.from(new Set([...app.tags, "b2b-approved"])),
      reviewedBy,
      reviewedAt: new Date(),
    },
  });

  // Best-effort Shopify customer tag (needs write_customers). Never blocks.
  try {
    const { tagCustomerApproved } = await import("./wholesale-shopify.server");
    await tagCustomerApproved(shopDomain, app.contactEmail, "b2b-approved");
  } catch {
    /* no-op — tagging is best-effort */
  }

  return { magicUrl: url };
}

export async function decideApplication(
  shopDomain: string,
  applicationId: string,
  decision: "APPROVED" | "REJECTED" | "MORE_INFO",
  reviewedBy: string,
  baseUrl: string,
  options: { customNote?: string } = {},
): Promise<void> {
  const shop = await shopFor(shopDomain);
  if (!shop) throw new NotFoundError();
  const app = await prisma.wholesaleApplication.findFirst({ where: { id: applicationId, shopId: shop.id } });
  if (!app) throw new NotFoundError();

  let magicUrl: string | null = null;
  if (decision === "APPROVED") {
    const res = await provisionApproval(applicationId, shopDomain, reviewedBy, baseUrl);
    magicUrl = res?.magicUrl ?? null;
  } else {
    await prisma.wholesaleApplication.update({
      where: { id: app.id },
      data: { status: decision, reviewedBy, reviewedAt: new Date() },
    });
  }

  await appendEvent({
    shopId: shop.id,
    type: "WHOLESALE_APPLICATION_DECIDED",
    entityType: "WholesaleApplication",
    entityId: app.id,
    payload: { status: decision },
  });

  // Decision email to the buyer.
  const template = resolveTemplate("application_decision", shop.emailTemplates);
  const rendered = renderTemplate(template, {
    companyName: app.companyName,
    decision:
      decision === "APPROVED" ? "approved" : decision === "REJECTED" ? "declined" : "in need of more information",
    portalUrl: magicUrl ?? `${baseUrl}/portal`,
    shopName: shopDomain,
  });
  // A merchant-reviewed custom note (e.g. Claude-drafted) leads the email; the
  // template body (with the portal link) follows so the message stays actionable.
  const note = options.customNote?.trim();
  const body = note ? `${note}\n\n${rendered.body}` : rendered.body;
  await sendEmail({ to: app.contactEmail, subject: rendered.subject, html: body, text: body });
}

/** Bulk approve a set of applications. */
export async function bulkApprove(
  shopDomain: string,
  ids: string[],
  reviewedBy: string,
  baseUrl: string,
): Promise<number> {
  let n = 0;
  for (const id of ids) {
    try {
      await decideApplication(shopDomain, id, "APPROVED", reviewedBy, baseUrl);
      n++;
    } catch {
      /* skip */
    }
  }
  return n;
}
