import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  createOrganization,
  createStoreInvite,
  generateInviteCode,
  getOrgForShop,
  hashInviteCode,
  joinWithInvite,
  normalizeInviteCode,
} from "./org.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("invite codes (pure)", () => {
  it("are readable, grouped and avoid look-alike characters", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^MNN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
  it("normalize what a merchant types (case, spaces, missing dashes)", () => {
    expect(normalizeInviteCode(" mnn 7kq2 xw9d 4tpa ")).toBe("MNN-7KQ2-XW9D-4TPA");
    expect(normalizeInviteCode("7KQ2XW9D4TPA")).toBe("MNN-7KQ2-XW9D-4TPA");
    expect(normalizeInviteCode("too-short")).toBe("");
  });
});

describe.skipIf(!hasDb)("agency store linking by invite (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "OrgInvite","OrgStore","Organization","Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup() {
    await prisma.shop.create({ data: { shopifyDomain: "agency.myshopify.com", plan: "GROWTH" } });
    await prisma.shop.create({ data: { shopifyDomain: "client.myshopify.com", plan: "SCALE" } });
    const org = await createOrganization("Northwind", "owner@northwind.example", "agency.myshopify.com", "GROWTH");
    if ("error" in org) throw new Error(org.error);
    return org.orgId;
  }

  it("stores only the hash; the client store joins with the code, by consent", async () => {
    const orgId = await setup();
    const invite = await createStoreInvite(orgId, "OWNER", "MANAGER");
    if (!invite.ok) throw new Error(invite.error);
    const row = await prisma.orgInvite.findFirstOrThrow({ where: { orgId } });
    expect(row.codeHash).toBe(hashInviteCode(invite.code));
    expect(JSON.stringify(row)).not.toContain(invite.code);

    const joined = await joinWithInvite("client.myshopify.com", invite.code.toLowerCase(), "https://app.example");
    expect(joined).toEqual({ ok: true, orgName: "Northwind" });
    expect((await getOrgForShop("client.myshopify.com"))?.myRole).toBe("MANAGER");
    expect(await prisma.event.count({ where: { type: "STORE_LINKED" } })).toBe(1);
  });

  it("is single use", async () => {
    const orgId = await setup();
    await prisma.shop.create({ data: { shopifyDomain: "other.myshopify.com", plan: "GROWTH" } });
    const invite = await createStoreInvite(orgId, "OWNER", "VIEWER");
    if (!invite.ok) throw new Error(invite.error);
    expect((await joinWithInvite("client.myshopify.com", invite.code, "https://app.example")).ok).toBe(true);
    const again = await joinWithInvite("other.myshopify.com", invite.code, "https://app.example");
    expect(again.ok).toBe(false);
    expect(await getOrgForShop("other.myshopify.com")).toBeNull();
  });

  it("expires", async () => {
    const orgId = await setup();
    const invite = await createStoreInvite(orgId, "OWNER", "MANAGER", new Date("2026-01-01T00:00:00Z"));
    if (!invite.ok) throw new Error(invite.error);
    const r = await joinWithInvite("client.myshopify.com", invite.code, "https://app.example", new Date("2026-01-09T00:00:00Z"));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  it("viewers can't invite; an invite never grants OWNER", async () => {
    const orgId = await setup();
    expect((await createStoreInvite(orgId, "VIEWER", "MANAGER")).ok).toBe(false);
    const invite = await createStoreInvite(orgId, "MANAGER", "OWNER");
    if (!invite.ok) throw new Error(invite.error);
    await joinWithInvite("client.myshopify.com", invite.code, "https://app.example");
    expect((await getOrgForShop("client.myshopify.com"))?.myRole).toBe("MANAGER");
  });

  it("refuses a store below Growth, or one already in an organization", async () => {
    const orgId = await setup();
    await prisma.shop.create({ data: { shopifyDomain: "small.myshopify.com", plan: "STARTER" } });
    const invite = await createStoreInvite(orgId, "OWNER", "MANAGER");
    if (!invite.ok) throw new Error(invite.error);
    expect(await joinWithInvite("small.myshopify.com", invite.code, "https://app.example")).toMatchObject({ ok: false, error: expect.stringMatching(/Growth/) });
    expect(await joinWithInvite("agency.myshopify.com", invite.code, "https://app.example")).toMatchObject({ ok: false, error: expect.stringMatching(/already part/) });
    // The code was not consumed by the refused attempts.
    expect((await joinWithInvite("client.myshopify.com", invite.code, "https://app.example")).ok).toBe(true);
  });
});
