# Feature 14 — Tax Exemption & VAT/GST Handling

Collect exemption documents, validate tax IDs, and apply the right tax at
quote/checkout — GCC VAT (KSA 15% / UAE 5%), EU VAT, US resale. Dark-launched
behind `MANNON_FF_TAX_VAT`.

## We never compute tax (guardrail #1)

Shopify calculates all tax. This feature only:

1. Stores each company's **tax profile** + certificate and its verification state.
2. Decides the **`taxExempt` flag** we set on the draft order for a
   verified-exempt buyer — **Shopify then zeroes the tax**.
3. Displays tax status and keeps invoice numbering compliant.

`resolveTaxTreatment` (`app/lib/tax.ts`) returns only a boolean flag + display
copy — never a rate or an amount we apply ourselves.

## Default-taxed until verified (the guardrail)

`resolveTaxTreatment(profile, regionRule)` is pure and unit-tested:

- Exempt **only** when the profile is `VERIFIED` **and** flagged exempt, or the
  merchant set the region to `exemptByDefault`.
- An `UNVERIFIED` or `REJECTED` profile is **always taxed** — an upload never
  auto-exempts.

## Certificate security

Uploaded certificates are stored **privately** as bytes on `TaxProfile`
(`certificateData`), never as a public URL, capped at 5 MB. They download **only**
through `/app/tax/certificate/:companyId`, which is behind the Shopify admin
session and ownership-checked in the service. Time-limited certs
(`certificateExpiresAt`) trigger expiry reminder emails via
`/internal/cron/tax-reminders` (idempotent per 30-day window via
`certExpiryRemindedAt`).

## Tax-ID validation (Growth)

`validateTaxId(type, value)` does **format** checks (not a live registry lookup —
VIES/ZATCA calls are a documented follow-up):

| Type | Check |
|---|---|
| VAT | EU VIES-style (`XX` + 2–13 alphanumerics) **or** KSA 15-digit (starts/ends with 3) |
| GST | India GSTIN 15-char pattern |
| ABN | 11 digits + weighted modulus-89 checksum |
| EIN | 9 digits |
| OTHER | non-trivial alphanumeric |

## Compliant invoice numbering (Growth)

`allocateInvoiceNumber(shopId, plan)` atomically increments `Shop.invoiceSeq` and
returns `INV-000042`. F2's `createInvoiceForOrder` stores it on `Invoice.sequenceNo`;
the reminder emails render the compliant number when present, else the legacy
id-based label.

## Plan gating (partial)

| Capability | Starter | Growth |
|---|---|---|
| Single default tax rate | ✓ | ✓ |
| Manual per-company exempt toggle | ✓ | ✓ |
| Per-region rules | — | ✓ |
| Certificate + verification workflow | — | ✓ |
| Tax-ID validation | — | ✓ |
| Compliant invoice numbering | — | ✓ |

## Data model (migration `f14_tax_vat`)

- `TaxProfile { taxId?, taxIdType, exempt, status, verifiedAt?, rejectedReason?, certificate* }` — one per company.
- `TaxRuleOverride { region, rate?, exemptByDefault }` — per shop.
- `Shop.defaultTaxRate`, `Shop.invoiceSeq`, `Invoice.sequenceNo`.
- Event `TAX_PROFILE_VERIFIED`.

## Reconciliation / notes

- **Region matching by the company's billing country** needs a Shopify Admin read
  of the company location — a documented follow-up. Today, profile-level treatment
  fully drives exemption; region `exemptByDefault` is applied where a region is
  known/previewed.
- Live registry validation (VIES / ZATCA) is a follow-up; current validation is
  format-only.
- No new Shopify OAuth scope. `taxExempt` on the draft order is the only Shopify
  write, and it removes tax rather than computing it.
