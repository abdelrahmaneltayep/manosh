// F5 — client-safe, pure helpers for company accounts: seat allowance, approval
// routing, and role capabilities. Shared by the portal UI and the server, and
// unit-tested (seat enforcement + approval-threshold routing).

export type CompanyRole = "ADMIN" | "BUYER" | "APPROVER";
export type MemberStatus = "INVITED" | "ACTIVE";

export const ROLE_LABELS: Record<CompanyRole, string> = {
  ADMIN: "Admin",
  BUYER: "Buyer",
  APPROVER: "Approver",
};

/** Only admins manage members (invite / change roles / remove). */
export function canManageMembers(role: CompanyRole): boolean {
  return role === "ADMIN";
}

/** Admins and approvers can decide an approval request. */
export function canApprove(role: CompanyRole): boolean {
  return role === "ADMIN" || role === "APPROVER";
}

export interface MemberAllowance {
  allowed: boolean;
  used: number;
  cap: number;
}

/** Pure: is there room for another member? `used` counts active + invited. */
export function evaluateMemberAllowance(used: number, cap: number): MemberAllowance {
  return { allowed: used < cap, used, cap };
}

/**
 * Does an order of `total` need approval? True only when the company has a
 * positive threshold and the total reaches it. A null/zero threshold means no
 * approval chain (e.g. Starter). Pure.
 */
export function needsApproval(total: number, threshold: number | null | undefined): boolean {
  if (threshold == null || !Number.isFinite(threshold) || threshold <= 0) return false;
  if (!Number.isFinite(total)) return false;
  return total >= threshold;
}

/** Emails of the members who can approve (admins + approvers). Pure. */
export function routeToApprovers(
  members: Array<{ email: string; role: CompanyRole; status: MemberStatus }>,
): string[] {
  return members
    .filter((m) => m.status === "ACTIVE" && canApprove(m.role))
    .map((m) => m.email);
}

/** Merchant/member-facing copy when the seat cap is hit. */
export function memberCapMessage(cap: number): string {
  return cap <= 1
    ? "Your plan includes a single buyer. Upgrade to Growth to add up to 5 team members with roles and approvals."
    : `Your plan includes ${cap} team members. That's the maximum for this plan.`;
}
