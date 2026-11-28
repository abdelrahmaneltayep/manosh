// Checks and preview for an email template the merchant edits (Phase 2, 5.3).
// Pure and client-safe: the editor shows problems and a live preview as the
// merchant types, and the server repeats the same checks before saving.

/** The {{placeholders}} a template uses. */
export function placeholders(t: { subject: string; body: string }): string[] {
  return [...new Set([...`${t.subject} ${t.body}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
}

/**
 * What's wrong with an edited template, measured against Mannon's default:
 * - missing: a link the default carries (any placeholder ending in "Url").
 *   Without it the recipient has no way to act, so saving is blocked.
 * - unknown: a placeholder Mannon can't fill (a typo, or one from another
 *   email). It would arrive blank, so saving is blocked too.
 */
export function checkTemplate(
  defaults: { subject: string; body: string },
  edited: { subject: string; body: string },
): { missing: string[]; unknown: string[] } {
  const known = placeholders(defaults);
  const used = placeholders(edited);
  return {
    missing: known.filter((v) => /Url$/.test(v) && !used.includes(v)),
    unknown: used.filter((v) => !known.includes(v)),
  };
}

/** Plain-language problem list, or null when the template is fine. */
export function templateProblem(check: { missing: string[]; unknown: string[] }): string | null {
  const parts: string[] = [];
  if (check.missing.length) parts.push(`Put back ${check.missing.map((v) => `{{${v}}}`).join(", ")}: it’s the link the recipient needs.`);
  if (check.unknown.length) parts.push(`Mannon can’t fill ${check.unknown.map((v) => `{{${v}}}`).join(", ")}, so it would arrive blank.`);
  return parts.length ? parts.join(" ") : null;
}

const SAMPLES: Record<string, string> = {
  buyerName: "Sam Rivera",
  shopName: "Harbor Coffee Wholesale",
  companyName: "Northwind Cafés",
  email: "sam@northwind.example",
  buyerEmail: "sam@northwind.example",
  contactEmail: "sam@northwind.example",
  expiresAt: "2026-12-12",
  dueDate: "2026-12-12",
  amount: "USD 1,240.00",
  balance: "USD 620.00",
  invoiceNumber: "INV-0042",
  itemCount: "4",
  companyLine: "\nCompany: Northwind Cafés",
  decision: "approved",
  role: "Buyer",
  terms: "Net 30",
  listName: "Weekly espresso order",
  catalogTitle: "Wholesale coffee",
  repName: "Alex Chen",
  provider: "QuickBooks",
  failed: "2",
  reason: "The certificate has expired.",
  status: "Exempt",
  quotes: "12",
  winRate: "58%",
  pipeline: "USD 18,400",
  orgName: "Northwind Group",
  portalName: "Mannon",
};

/** Sample values for every placeholder, so the preview reads like a real email. */
export function sampleValues(vars: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) {
    out[v] = SAMPLES[v] ?? (/Url$/.test(v) ? "https://example.com/link" : `[${v}]`);
  }
  return out;
}

/** Fill placeholders (unknown ones stay visible as {{name}} so the merchant sees them). */
export function renderPreview(t: { subject: string; body: string }, values: Record<string, string>) {
  const fill = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, k: string) => values[k] ?? whole);
  return { subject: fill(t.subject), body: fill(t.body) };
}
