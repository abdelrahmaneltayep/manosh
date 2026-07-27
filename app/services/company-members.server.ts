import type { CompanyRole } from "@prisma/client";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { issueMagicLink } from "./magic-link.server";
import { resolveTemplate, renderTemplate, sendEmail } from "./mailer.server";

/**
 * F5 — company members. A member is a Buyer with a role + status, so the existing
 * passwordless magic-link flow is reused for invites. Seat cap is per-company and
 * enforced here on invite.
 */

export class MemberCapError extends Error {
  constructor(public cap: number) {
    super(`Team seat limit reached (${cap}).`);
    this.name = "MemberCapError";
  }
}
export class MemberExistsError extends Error {
  constructor() {
    super("That email is already a member.");
    this.name = "MemberExistsError";
  }
}
export class LastAdminError extends Error {
  constructor() {
    super("A company needs at least one admin.");
    this.name = "LastAdminError";
  }
}

export interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  role: CompanyRole;
  status: "INVITED" | "ACTIVE";
}

export async function listMembers(companyId: string): Promise<MemberRow[]> {
  const buyers = await prisma.buyer.findMany({
    where: { companyId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  return buyers as MemberRow[];
}

/** Count members that occupy a seat (active + invited). */
export async function countMembers(companyId: string): Promise<number> {
  return prisma.buyer.count({ where: { companyId } });
}

export async function getMember(companyId: string, buyerId: string): Promise<MemberRow | null> {
  const b = await prisma.buyer.findFirst({
    where: { id: buyerId, companyId },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  return b as MemberRow | null;
}

export interface InviteResult {
  member: { id: string; email: string };
  inviteUrl: string;
}

/**
 * Invite a member by email (magic-link), enforcing the seat cap. Emits
 * MEMBER_INVITED and best-effort sends the invite email.
 */
export async function inviteMember(
  companyId: string,
  input: { email: string; role: CompanyRole; baseUrl: string },
  cap: number,
): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new MemberExistsError();

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { shop: { select: { id: true, shopifyDomain: true, emailTemplates: true } } },
  });
  if (!company) throw new MemberExistsError();

  const existing = await prisma.buyer.findFirst({ where: { companyId, email } });
  if (existing) throw new MemberExistsError();

  const count = await countMembers(companyId);
  if (count >= cap) throw new MemberCapError(cap);

  const member = await prisma.buyer.create({
    data: { companyId, email, role: input.role, status: "INVITED", invitedAt: new Date() },
    select: { id: true, email: true },
  });

  const { url } = await issueMagicLink(member.id, { baseUrl: input.baseUrl });

  await appendEvent({
    shopId: company.shop.id,
    type: "MEMBER_INVITED",
    entityType: "Buyer",
    entityId: member.id,
    payload: { role: input.role },
  });

  const template = resolveTemplate("member_invite", company.shop.emailTemplates);
  const { subject, body } = renderTemplate(template, {
    companyName: company.name,
    inviteUrl: url,
    role: input.role,
    shopName: company.shop.shopifyDomain,
  });
  await sendEmail({ to: email, subject, html: body, text: body });

  return { member, inviteUrl: url };
}

export async function setMemberRole(companyId: string, buyerId: string, role: CompanyRole): Promise<void> {
  // Don't allow demoting the last admin.
  if (role !== "ADMIN") {
    const admins = await prisma.buyer.count({ where: { companyId, role: "ADMIN" } });
    const target = await prisma.buyer.findFirst({ where: { id: buyerId, companyId }, select: { role: true } });
    if (target?.role === "ADMIN" && admins <= 1) throw new LastAdminError();
  }
  await prisma.buyer.updateMany({ where: { id: buyerId, companyId }, data: { role } });
}

export async function removeMember(companyId: string, buyerId: string): Promise<void> {
  const target = await prisma.buyer.findFirst({ where: { id: buyerId, companyId }, select: { role: true } });
  if (!target) return;
  if (target.role === "ADMIN") {
    const admins = await prisma.buyer.count({ where: { companyId, role: "ADMIN" } });
    if (admins <= 1) throw new LastAdminError();
  }
  await prisma.buyer.deleteMany({ where: { id: buyerId, companyId } });
}
