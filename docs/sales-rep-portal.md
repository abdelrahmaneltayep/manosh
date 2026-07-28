# Feature 12 — Sales-Rep Portal (Order-on-Behalf & Assigned Accounts)

Let a merchant's sales reps sign in to a scoped portal, see only their assigned
companies, and place or negotiate orders on behalf of buyers. Growth-only,
dark-launched behind `MANNON_FF_REP_PORTAL`.

## Plan availability

Growth only. Starter hides the Reps tab with "Add your sales team — upgrade to
Growth." Gated by `repPortalAllowed(plan)` (`app/lib/billing.ts`) on the admin
loader/actions, the rep auth route, and the rep portal. `PLAN_LIMITS.repSeatCap`
= 0 (Starter) / 3 (Growth).

## Auth

Reps authenticate with the **same passwordless magic-link mechanism as buyers**:
a 256-bit token, **hashed at rest** on the `SalesRep` row (`magicTokenHash`,
guardrail #7), single-use (atomic consume), 7-day expiry. Consuming the link
flips the rep `INVITED → ACTIVE`. The rep session is a separate signed cookie
(`__mannon_rep`, scoped to `/rep`) — isolated from both the Shopify admin session
and the buyer session.

## Strict data isolation (the guarantee)

`repCanAccessCompany(assignedCompanyIds, companyId)` (`app/lib/rep.ts`, pure) is
the single source of truth. Every rep-facing read enforces it:

- `listAssignedCompanies(repId)` returns **only** rows in `RepAssignment`.
- `getRepCompany(repId, companyId)` returns **null** (→ the route throws 404)
  unless a `RepAssignment(repId, companyId)` exists.

A rep can never see, load, or act on an unassigned company — there is no code
path that reads a company by id without first checking assignment.

## Order-on-behalf + impersonation audit

- The rep enters an impersonation context (`?as=<buyerId>`), clearly banner-marked
  (`impersonationBannerText`). The order pad is the buyer's **F11-visible** catalog
  at the buyer's **F3** price.
- Submitting calls the normal `submitBuyerQuote(...)` with `placedByRepId`, so the
  quote stays the **buyer's** but carries the rep attribution. All buyer-side
  guards still run: F9 MOQ/minimums, F5 spending approvals, quote caps.
- `recordOnBehalf` appends `ORDER_PLACED_ON_BEHALF` with **rep + buyer ids** (ids
  only, no PII — guardrail #6) and emails the buyer a transparency notice
  (`rep_order_placed`). The rep **cannot** change credit limits or company
  settings — those routes are admin-only and never exposed in `/rep`.

## Leaderboard

`repLeaderboard(shopDomain)` → `buildRepLeaderboard(reps, quotes)` (pure): per-rep
quotes, orders (accepted/ordered), and win rate, from quotes where
`placedByRepId` is set. Reps with no attributed quotes still appear (0/0).

## Data model (migration `f12_sales_rep_portal`)

- `SalesRep { email, name?, status, magicTokenHash?, magicTokenExpiresAt?, invitedAt? }` — unique `(shop, email)`.
- `RepAssignment { repId, companyId }` — unique `(rep, company)`.
- `Quote.placedByRepId?` → the rep attribution (the "order" is the accepted quote's Shopify draft order).
- Events `REP_INVITED`, `ORDER_PLACED_ON_BEHALF`.

## Reconciliation / notes

- The prompt's "Order.placedByRepId" maps to **`Quote.placedByRepId`** — Mannon
  orders are Shopify draft orders created from an accepted quote, so the quote is
  the durable attribution point. The prompt's "CompanyMember actingAsRep audit
  note" is realized as the `ORDER_PLACED_ON_BEHALF` event (rep + buyer ids) plus
  `placedByRepId`, since Mannon models a member as a `Buyer`.
- No new Shopify OAuth scope. Rep-seat overage beyond the plan cap is a
  contact-us/add-on path (documented copy), not a hard product wall.
