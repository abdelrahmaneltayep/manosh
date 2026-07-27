# Feature 5 — Company Accounts & Multi-Buyer Sub-Accounts

Multiple buyers under one company, with roles and a spending-approval chain.

## Plan availability

| Capability | Starter | Growth |
|---|---|---|
| Members per company | **1** | up to **5** |
| Roles (admin / buyer / approver) | — | ✓ |
| Spending approvals + threshold | — | ✓ |

`PLAN_LIMITS.memberCap` (`app/lib/billing.ts`) = 1 (Starter) / 5 (Growth). The 2nd
invite, the approver/admin roles, and the approval chain are Growth-only. Dark-
launched behind `MANNON_FF_COMPANY_ACCOUNTS`.

## Model (migration `f5_company_accounts`)

- **`Buyer` extended** — `role` (`CompanyRole`), `status` (`MemberStatus`),
  `invitedAt`. A buyer *is* a company member, so invites reuse the existing
  passwordless magic-link flow directly (this is the reconciliation of the spec's
  `CompanyMember` onto our identity model). The migration backfills the earliest
  buyer per company to `ADMIN`.
- **`Company.approvalThreshold`** — order total that triggers approval.
- **`OrderApproval`** — one per quote (`quoteId` unique): requester, optional
  approver, amount, `status` (pending / approved / rejected).
- Events `MEMBER_INVITED`, `ORDER_APPROVED`.

## Flows

**Invite** (`company-members.server.ts`): admin invites by email from the Team tab
→ a `Buyer` (status `INVITED`) is created, a magic link is issued and emailed
(`member_invite` template), and `MEMBER_INVITED` is recorded. The seat cap is
enforced here; the last admin can't be removed/demoted.

**Approval** (`approvals.server.ts`): on accept, if company accounts are on, the
plan is Growth, and the quote's estimated total (`sum(qty × price)`) reaches the
threshold, the order is held: a pending `OrderApproval` is created, approvers
(active admins + approvers) are emailed a deep-link, and the buyer sees "Waiting
for approval". An approver approves (→ `ORDER_APPROVED`, order can be placed) or
rejects (→ order blocked). Pure routing/threshold logic lives in
`app/lib/company-accounts.ts` and is unit-tested.

## Guardrails

The approval amount is an estimate for routing only; the order still settles on a
Shopify draft order (guardrail #1). The email transport is the F2 no-op mailer
until configured — `OrderApproval` records and the in-portal approve/reject flow
work regardless.
