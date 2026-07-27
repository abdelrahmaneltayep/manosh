// F6 — client-safe, pure helpers for wholesale registration: auto-approval,
// form-cap gating, submission validation, and the spam honeypot. Shared by the
// public form, the admin builder, and the server; unit-tested.

export type WholesaleFieldType = "TEXT" | "EMAIL" | "SELECT" | "FILE" | "CHECKBOX";
export type WholesaleStatus = "PENDING" | "APPROVED" | "REJECTED" | "MORE_INFO";

export const STATUS_LABELS: Record<WholesaleStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  MORE_INFO: "More info requested",
};

/** The name of the honeypot field. A bot fills it; a human never sees it. */
export const HONEYPOT_FIELD = "company_url_confirm";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The lowercased domain part of an email, or null. Pure. */
export function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Auto-approve when the applicant's email domain is in the allowlist. Empty
 * allowlist ⇒ never auto-approve (manual review). Pure.
 */
export function shouldAutoApprove(email: string, allowlistDomains: string[] | null | undefined): boolean {
  if (!allowlistDomains || allowlistDomains.length === 0) return false;
  const domain = emailDomain(email);
  if (!domain) return false;
  return allowlistDomains.some((d) => d.trim().toLowerCase() === domain);
}

export interface FormAllowance {
  allowed: boolean;
  used: number;
  cap: number;
}
export function evaluateFormAllowance(used: number, cap: number): FormAllowance {
  return { allowed: used < cap, used, cap };
}

/** True when the honeypot was filled (⇒ treat as spam, silently). Pure. */
export function isHoneypotTripped(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export interface FieldSpec {
  key: string;
  label: string;
  type: WholesaleFieldType;
  required: boolean;
}

export type SubmissionValues = Record<string, string | undefined>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a public submission against the form's fields: required present,
 * email fields well-formed. Pure — the security-relevant checks the server runs.
 */
export function validateSubmission(fields: FieldSpec[], values: SubmissionValues): ValidationResult {
  const errors: string[] = [];
  for (const f of fields) {
    const raw = (values[f.key] ?? "").trim();
    if (f.required && !raw && f.type !== "CHECKBOX") {
      errors.push(`${f.label} is required.`);
      continue;
    }
    if (f.required && f.type === "CHECKBOX" && raw !== "on" && raw !== "true") {
      errors.push(`${f.label} is required.`);
      continue;
    }
    if (f.type === "EMAIL" && raw && !EMAIL_RE.test(raw)) {
      errors.push(`${f.label} must be a valid email.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** A stable machine key from a label (for custom questions). Pure. */
export function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";
}

/** Merchant-facing copy when the form cap is hit. */
export function formCapMessage(cap: number): string {
  return `Your plan includes ${cap} wholesale form${cap === 1 ? "" : "s"}. Upgrade to Growth for multiple forms, file uploads, and auto-approval rules.`;
}
