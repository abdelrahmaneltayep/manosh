// F17 — pure logic for the storefront "Request a Quote" widget: input
// validation + escaping, the anti-spam checks (honeypot + too-fast submit), and
// line normalization. No Prisma, no network — unit-tested. Reuses the F6 honeypot
// field name so a single hidden field guards both public forms.

import { HONEYPOT_FIELD, isHoneypotTripped } from "./wholesale";
export { HONEYPOT_FIELD, isHoneypotTripped };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_TEXT = 2000;
const MAX_LINES = 100;

/** Strip control chars + angle brackets and cap length. Anonymous input is never trusted. */
export function escapeText(input: unknown, max = MAX_TEXT): string {
  return String(input ?? "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export interface RawLine {
  variantId?: unknown;
  sku?: unknown;
  title?: unknown;
  quantity?: unknown;
}

export interface CleanLine {
  variantId: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
}

/** Normalize submitted lines: escape strings, coerce qty ≥ 1, drop empties, cap count. Pure. */
export function normalizeLines(raw: unknown): CleanLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: CleanLine[] = [];
  for (const r of raw.slice(0, MAX_LINES)) {
    const row = (r ?? {}) as RawLine;
    const variantId = row.variantId ? escapeText(row.variantId, 255) : null;
    const sku = row.sku ? escapeText(row.sku, 120) : null;
    const title = row.title ? escapeText(row.title, 255) : null;
    const quantity = Math.max(1, Math.trunc(Number(row.quantity) || 0));
    if (!variantId && !sku && !title) continue; // nothing to identify the line
    lines.push({ variantId, sku, title, quantity });
  }
  return lines;
}

export interface QuoteRequestInput {
  email?: unknown;
  companyName?: unknown;
  note?: unknown;
  lines?: unknown;
  honeypot?: unknown;
  elapsedMs?: number; // ms between render and submit (bot detection)
  customFields?: Record<string, unknown>;
}

export interface CleanQuoteRequest {
  email: string;
  companyName: string | null;
  note: string | null;
  lines: CleanLine[];
  customFields: Record<string, string> | null;
}

export type ValidateResult =
  | { ok: true; value: CleanQuoteRequest }
  | { ok: false; error: string; spam?: boolean };

/** Too-fast submit → almost certainly a bot. Pure. */
export function isTooFast(elapsedMs: number | undefined, minMs = 1200): boolean {
  return typeof elapsedMs === "number" && elapsedMs >= 0 && elapsedMs < minMs;
}

/**
 * Validate + clean a storefront quote-request submission. Anti-spam (honeypot +
 * too-fast) fails silently as spam so bots get a generic OK upstream. Pure.
 */
export function validateQuoteRequest(input: QuoteRequestInput): ValidateResult {
  // Anti-spam first (fail quietly — the caller returns a generic success).
  if (isHoneypotTripped(input.honeypot) || isTooFast(input.elapsedMs)) {
    return { ok: false, error: "spam", spam: true };
  }

  const email = escapeText(input.email, 254).toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };

  const lines = normalizeLines(input.lines);
  const note = input.note ? escapeText(input.note) : null;
  if (lines.length === 0 && !note) return { ok: false, error: "Add at least one product or a note." };

  const companyName = input.companyName ? escapeText(input.companyName, 255) : null;

  let customFields: Record<string, string> | null = null;
  if (input.customFields && typeof input.customFields === "object") {
    customFields = {};
    for (const [k, v] of Object.entries(input.customFields).slice(0, 20)) {
      customFields[escapeText(k, 60)] = escapeText(v, 500);
    }
  }

  return { ok: true, value: { email, companyName, note, lines, customFields } };
}
