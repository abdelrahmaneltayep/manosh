import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import {
  listMembers,
  countMembers,
  inviteMember,
  setMemberRole,
  removeMember,
  MemberCapError,
  MemberExistsError,
  LastAdminError,
} from "../services/company-members.server";
import { getPlanLimits } from "../lib/billing";
import {
  canManageMembers,
  evaluateMemberAllowance,
  memberCapMessage,
  ROLE_LABELS,
  type CompanyRole,
} from "../lib/company-accounts";

const ENABLED = () => process.env.MANNON_FF_COMPANY_ACCOUNTS === "true";

async function currentMember(request: Request) {
  const buyerId = await requireBuyerId(request);
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { company: { include: { shop: { select: { plan: true } } } } },
  });
  if (!buyer) throw redirect("/portal/signin");
  return buyer;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const me = await currentMember(request);
  if (!ENABLED()) throw new Response("Not found", { status: 404 });

  const [members, used] = await Promise.all([
    listMembers(me.companyId),
    countMembers(me.companyId),
  ]);
  const cap = getPlanLimits(me.company.shop.plan).memberCap;
  const allowance = evaluateMemberAllowance(used, cap);

  return {
    company: me.company.name,
    isAdmin: canManageMembers(me.role),
    isGrowth: me.company.shop.plan === "GROWTH",
    myId: me.id,
    approvalThreshold: me.company.approvalThreshold ? Number(me.company.approvalThreshold) : null,
    members,
    allowance: { allowed: allowance.allowed, used: allowance.used, cap: Number.isFinite(cap) ? cap : null },
    capMessage: memberCapMessage(Number.isFinite(cap) ? cap : 1),
  };
};

type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const me = await currentMember(request);
  if (!ENABLED()) return { ok: false, error: "This feature isn’t available." };
  if (!canManageMembers(me.role)) return { ok: false, error: "Only an admin can manage the team." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const cap = getPlanLimits(me.company.shop.plan).memberCap;

  try {
    if (intent === "invite") {
      const email = String(form.get("email") ?? "");
      const role = (String(form.get("role") ?? "BUYER") as CompanyRole) || "BUYER";
      // Approver role + the 2nd seat are Growth-only.
      if (me.company.shop.plan !== "GROWTH" && (role === "APPROVER" || cap <= 1)) {
        return { ok: false, error: memberCapMessage(cap) };
      }
      await inviteMember(me.companyId, { email, role, baseUrl: new URL(request.url).origin }, cap);
      return { ok: true, message: `Invited ${email}.` };
    }
    if (intent === "set-role") {
      if (me.company.shop.plan !== "GROWTH") return { ok: false, error: "Roles are a Growth feature." };
      await setMemberRole(me.companyId, String(form.get("memberId") ?? ""), String(form.get("role") ?? "BUYER") as CompanyRole);
      return { ok: true, message: "Role updated." };
    }
    if (intent === "remove") {
      await removeMember(me.companyId, String(form.get("memberId") ?? ""));
      return { ok: true, message: "Member removed." };
    }
    if (intent === "set-threshold") {
      if (me.company.shop.plan !== "GROWTH") return { ok: false, error: "Approval thresholds are a Growth feature." };
      const raw = String(form.get("threshold") ?? "").trim();
      const value = raw === "" ? null : Number(raw);
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        return { ok: false, error: "Enter a valid amount, or leave blank for no approvals." };
      }
      await prisma.company.update({
        where: { id: me.companyId },
        data: { approvalThreshold: value == null ? null : value.toFixed(4) },
      });
      return { ok: true, message: "Approval threshold saved." };
    }
    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof MemberCapError) return { ok: false, error: memberCapMessage(error.cap) };
    if (error instanceof MemberExistsError) return { ok: false, error: "That email is already a member." };
    if (error instanceof LastAdminError) return { ok: false, error: "A company needs at least one admin." };
    throw error;
  }
};

const ROLES: CompanyRole[] = ["ADMIN", "BUYER", "APPROVER"];

export default function Team() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CompanyRole>("BUYER");
  const [threshold, setThreshold] = useState(data.approvalThreshold != null ? String(data.approvalThreshold) : "");

  const err = actionData && !actionData.ok ? actionData.error : null;
  const msg = actionData && actionData.ok ? actionData.message : null;

  return (
    <section className="portal-card">
      <h1>Team</h1>
      <p className="muted">{data.company}</p>

      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}

      {!data.isGrowth && (
        <div className="quick-order-unresolved">
          <strong>Single buyer on Starter.</strong> Upgrade to Growth to add up to 5
          members with roles (admin / buyer / approver) and spending approvals.
        </div>
      )}

      <h2 className="portal-subhead">Members ({data.allowance.used}{data.allowance.cap ? ` / ${data.allowance.cap}` : ""})</h2>
      {data.members.length === 0 ? (
        <p className="muted">No members yet. Invite your first teammate below.</p>
      ) : (
        <ul className="quote-list">
          {data.members.map((m) => (
            <li key={m.id} className="quote-list-row">
              <span>
                <strong>{m.email}</strong>
                <span className="muted"> · {ROLE_LABELS[m.role]}{m.status === "INVITED" ? " · invited" : ""}</span>
              </span>
              {data.isAdmin && m.id !== data.myId && (
                <span className="portal-actions">
                  {data.isGrowth && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="set-role" />
                      <input type="hidden" name="memberId" value={m.id} />
                      <select name="role" defaultValue={m.role} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </Form>
                  )}
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="memberId" value={m.id} />
                    <button type="submit" className="portal-link-button">Remove</button>
                  </Form>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Invite */}
      {data.isAdmin && (
        <>
          <h2 className="portal-subhead">Invite a member</h2>
          {data.allowance.allowed ? (
            <Form method="post" className="accept-form">
              <input type="hidden" name="intent" value="invite" />
              <label className="field">
                <span className="field-label">Email</span>
                <input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required />
              </label>
              <label className="field">
                <span className="field-label">Role</span>
                <select name="role" value={role} onChange={(e) => setRole(e.target.value as CompanyRole)} disabled={!data.isGrowth}>
                  <option value="BUYER">Buyer</option>
                  <option value="APPROVER">Approver (Growth)</option>
                  <option value="ADMIN">Admin (Growth)</option>
                </select>
              </label>
              <button type="submit" className="portal-button" disabled={busy}>Send invite</button>
            </Form>
          ) : (
            <div className="quick-order-unresolved">
              <p>{data.capMessage}</p>
            </div>
          )}
        </>
      )}

      {/* Approval threshold (Growth admins) */}
      {data.isAdmin && data.isGrowth && (
        <>
          <h2 className="portal-subhead">Spending approvals</h2>
          <p className="muted">
            Orders at or above this total route to an approver before they can be
            placed. Leave blank to turn approvals off.
          </p>
          <Form method="post" className="accept-form">
            <input type="hidden" name="intent" value="set-threshold" />
            <label className="field">
              <span className="field-label">Approval threshold</span>
              <input type="number" name="threshold" min={0} step="0.01" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="e.g. 5000" />
            </label>
            <button type="submit" className="portal-button" disabled={busy}>Save threshold</button>
          </Form>
        </>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <Link to="/portal" className="portal-link">← Back to portal</Link>
      </p>
    </section>
  );
}
