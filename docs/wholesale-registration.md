# Feature 6 — Wholesale Registration + Gated Approval

A branded "apply to buy wholesale" funnel: a custom signup form, an approval
queue (manual or auto), and account provisioning that gates trade pricing until a
buyer is approved. Top of the funnel that feeds every other feature.

## Plan availability

| Capability | Starter | Growth |
|---|---|---|
| Application forms | **1** | unlimited |
| Approval queue (approve / reject / more info) | ✓ | ✓ |
| File-upload fields | — | ✓ |
| Auto-approval rules (by email domain) | — | ✓ |

`PLAN_LIMITS.wholesaleFormCap` (`app/lib/billing.ts`) = 1 (Starter) / ∞ (Growth).
The 2nd form, file fields, and auto-approval are Growth-only. Dark-launched behind
`MANNON_FF_WHOLESALE_REG`.

## Model (migration `f6_wholesale_registration`)

- `WholesaleForm` (per shop; `published`, `isDefault`, `autoApproveDomains`) +
  `WholesaleFormField` (label / key / type / required / options / order).
- `WholesaleApplication` (companyName, contactEmail, answers JSON, `status`,
  `tags`, `companyId` on approve). Event `WHOLESALE_APPLICATION_DECIDED`.

> Reconciliation: the spec's `WholesaleFormField.shop` is modelled as fields
> belonging to a `WholesaleForm` (needed for the "1 vs many forms" gate). The
> public URL `/apply/:shop` renders the shop's default published form.

## Flows

**Build** — `/app/wholesale` lists forms + the queue; `/app/wholesale/forms/:id`
is the field builder (add/delete fields, types, required, dropdown options),
publish toggle, and auto-approval domains (Growth).

**Apply** — `/apply/:shop` renders the default published form with **no login**.
Submission is guarded by a honeypot (`isHoneypotTripped`), a per-`shop:ip` rate
limit, and email dedupe. Required/email validation is the pure `validateSubmission`.

**Approve** — from the queue, or automatically (Growth) when the email domain is
allowlisted (`shouldAutoApprove`). `provisionApproval` creates an F5 `Company` +
an admin `Buyer` (magic link), assigns the F3 default price list, tags
`b2b-approved`, and best-effort tags the Shopify customer (`write_customers`,
documented in `docs/compliance.md`). The buyer is emailed a passwordless link;
until then their trade pricing stays gated (no portal access).

## Guardrails

Pure gating + submission logic (`app/lib/wholesale.ts`) is unit-tested. The
Shopify customer tag is best-effort and never blocks approval. File fields capture
the filename only in this slice (binary storage via Shopify Files is a follow-up).
The email transport is the F2 no-op mailer until configured.
