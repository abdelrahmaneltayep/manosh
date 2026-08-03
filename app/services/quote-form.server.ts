import type { QuoteFormSurface as PrismaSurface, QuoteFormSuccessMode } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { quoteFormFeatures, quoteCaptureAllowed } from "../lib/billing";
import {
  normalizeFields,
  stripAdvanced,
  normalizeTranslations,
  localizeForm,
  type QuoteFormField,
  type QuoteFormSurface,
  type Translations,
} from "../lib/quote-form";

/**
 * F24.1 — storefront quote form builder service. The merchant builds forms in
 * embedded Polaris; the theme app extension renders the active form for its
 * surface (see getPublicForm). The basic builder is on every plan; advanced
 * controls (conditional logic, multiple forms) are Growth — enforced here and in
 * the UI. Dark-launched behind MANNON_FF_QUOTE_CAPTURE. Emits QUOTE_FORM_UPDATED.
 */

export const QUOTE_CAPTURE_ENABLED = () => process.env.MANNON_FF_QUOTE_CAPTURE === "true";

/** Thrown when a shop below Growth tries to keep more than one form. */
export class MultipleFormsError extends Error {
  constructor() {
    super("Multiple forms need the Growth plan.");
    this.name = "MultipleFormsError";
  }
}

async function shopIdFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { id: true } });
  return shop?.id ?? null;
}

async function planFor(shopDomain: string): Promise<string | null> {
  const shop = await prisma.shop.findUnique({ where: { shopifyDomain: shopDomain }, select: { plan: true } });
  return shop?.plan ?? null;
}

export type SuccessMode = "MESSAGE" | "REDIRECT";

export interface QuoteFormRow {
  id: string;
  name: string;
  surface: QuoteFormSurface;
  fields: QuoteFormField[];
  active: boolean;
  successMode: SuccessMode;
  successValue: string | null;
  translations: Translations;
  updatedAt: Date;
}

function toRow(r: { id: string; name: string; surface: PrismaSurface; fields: unknown; active: boolean; successMode: QuoteFormSuccessMode; successValue: string | null; translations: unknown; updatedAt: Date }): QuoteFormRow {
  return {
    id: r.id, name: r.name, surface: r.surface as QuoteFormSurface, fields: normalizeFields(r.fields), active: r.active,
    successMode: r.successMode as SuccessMode, successValue: r.successValue, translations: normalizeTranslations(r.translations), updatedAt: r.updatedAt,
  };
}

export async function listForms(shopDomain: string): Promise<QuoteFormRow[]> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return [];
  const rows = await prisma.quoteForm.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } });
  return rows.map(toRow);
}

export async function getForm(shopDomain: string, id: string): Promise<QuoteFormRow | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const row = await prisma.quoteForm.findFirst({ where: { id, shopId } });
  return row ? toRow(row) : null;
}

export interface SaveFormInput {
  id?: string | null;
  name: string;
  surface: QuoteFormSurface;
  fields: unknown; // normalised here
  active?: boolean;
  /** Post-submission control (Starter+): show a message or redirect to a URL. */
  successMode?: SuccessMode;
  successValue?: string | null;
  /** Per-locale overrides (Growth). Stripped below Growth. */
  translations?: unknown;
}

/**
 * Create or update a form. Enforces the plan cap: below Growth a shop keeps a
 * single form (creating a second throws MultipleFormsError). Fields are
 * normalised (unknown types dropped, keys deduped) before persisting. Emits
 * QUOTE_FORM_UPDATED.
 */
export async function saveForm(shopDomain: string, input: SaveFormInput): Promise<{ id: string } | { error: string }> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return { error: "Unknown shop." };
  const plan = await planFor(shopDomain);
  const features = quoteFormFeatures(plan);
  const advanced = features.conditionalLogic; // Growth
  const paid = quoteCaptureAllowed(plan); // Starter+

  // Conditional logic (showIf) + translations are Growth; post-submission control
  // is Starter+. Strip each server-side below its gate so a lower plan can't sneak
  // it in via the API.
  const normalized = normalizeFields(input.fields);
  const fields = advanced ? normalized : stripAdvanced(normalized);
  const successMode: QuoteFormSuccessMode = paid && input.successMode === "REDIRECT" ? "REDIRECT" : "MESSAGE";
  const successValue = paid ? (input.successValue?.trim() || null) : null;
  const translations = advanced ? (normalizeTranslations(input.translations) as object) : ({} as object);
  const name = input.name.trim() || "Quote form";
  const active = input.active ?? true;

  const writable = { name, surface: input.surface, fields: fields as object, active, successMode, successValue, translations };

  if (input.id) {
    const existing = await prisma.quoteForm.findFirst({ where: { id: input.id, shopId }, select: { id: true } });
    if (!existing) return { error: "Form not found." };
    await prisma.quoteForm.update({ where: { id: input.id }, data: writable });
    await appendEvent({ shopId, type: "QUOTE_FORM_UPDATED", entityType: "QuoteForm", entityId: input.id, payload: { fields: fields.length } });
    return { id: input.id };
  }

  // Creating a new form — enforce the single-form cap below Growth.
  if (!features.multipleForms) {
    const count = await prisma.quoteForm.count({ where: { shopId } });
    if (count >= 1) throw new MultipleFormsError();
  }
  const created = await prisma.quoteForm.create({ data: { shopId, ...writable }, select: { id: true } });
  await appendEvent({ shopId, type: "QUOTE_FORM_UPDATED", entityType: "QuoteForm", entityId: created.id, payload: { created: true, fields: fields.length } });
  return { id: created.id };
}

export async function deleteForm(shopDomain: string, id: string): Promise<void> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return;
  await prisma.quoteForm.deleteMany({ where: { id, shopId } });
  await appendEvent({ shopId, type: "QUOTE_FORM_UPDATED", entityType: "QuoteForm", entityId: id, payload: { deleted: true } });
}

/**
 * Public-safe form for a storefront surface: the active form's fields, or null
 * when none is configured (the extension then falls back to its built-in fields).
 * No secrets — just the field schema the buyer fills in.
 */
export async function getPublicForm(
  shopDomain: string,
  surface: QuoteFormSurface,
  locale?: string | null,
): Promise<{ formId: string; name: string; fields: QuoteFormField[]; successMode: SuccessMode; successValue: string | null } | null> {
  const shopId = await shopIdFor(shopDomain);
  if (!shopId) return null;
  const row = await prisma.quoteForm.findFirst({
    where: { shopId, active: true, surface },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, fields: true, successMode: true, successValue: true, translations: true },
  });
  if (!row) return null;
  // F24.5 — localize field labels/placeholders/help + the message to the storefront locale.
  const { fields, successValue } = localizeForm(normalizeFields(row.fields), row.successValue, normalizeTranslations(row.translations), locale);
  return { formId: row.id, name: row.name, fields, successMode: row.successMode as SuccessMode, successValue };
}

/** Validate that a formId belongs to the shop (used when storing a submission). */
export async function formBelongsToShop(shopId: string, formId: string): Promise<boolean> {
  const row = await prisma.quoteForm.findFirst({ where: { id: formId, shopId }, select: { id: true } });
  return !!row;
}

/**
 * F24.3 — public on/off for the storefront Add-to-Quote drawer + cart→quote.
 * Enabled when the feature flag is on and the shop is on a paid plan (Starter+).
 * No secrets — just a boolean the theme app block reads.
 */
export async function getQuoteCaptureConfig(shopDomain: string): Promise<{ enabled: boolean }> {
  if (!QUOTE_CAPTURE_ENABLED()) return { enabled: false };
  const plan = await planFor(shopDomain);
  return { enabled: quoteCaptureAllowed(plan) };
}
