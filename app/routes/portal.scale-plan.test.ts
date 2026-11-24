import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";
import prisma from "../db.server";

// Scale includes everything in Growth. These buyer-portal checks used to compare
// the store's plan to "GROWTH" only, so buyers of a Scale store lost the
// features. Each case runs for Growth, Scale and Starter.

let currentBuyerId = "";
vi.mock("../services/buyer-session.server", () => ({
  requireBuyerId: async () => currentBuyerId,
  getBuyerId: async () => currentBuyerId,
}));

import { loader as teamLoader, action as teamAction } from "./portal.team";
import { loader as quickLoader, action as quickAction } from "./portal.quick-order";
import { resetSubmitRate, submitApplication } from "../services/wholesale.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const args = (request: Request) => ({ request, params: {}, context: {} }) as never;
const post = (path: string, fields: Record<string, string>) =>
  new Request(`https://app.example.com${path}`, { method: "POST", body: new URLSearchParams(fields) });

async function seed(plan: Plan) {
  const shop = await prisma.shop.create({ data: { shopifyDomain: `scale-${plan.toLowerCase()}.myshopify.com`, plan } });
  const company = await prisma.company.create({
    data: { shopId: shop.id, shopifyCompanyId: `gid://shopify/Company/${plan}`, name: "Plan Co." },
  });
  const admin = await prisma.buyer.create({
    data: { companyId: company.id, email: "admin@example.com", name: "Admin", role: "ADMIN" },
  });
  const member = await prisma.buyer.create({
    data: { companyId: company.id, email: "member@example.com", name: "Member", role: "BUYER" },
  });
  currentBuyerId = admin.id;
  return { shop, company, admin, member };
}

const GROWTH_TIER: Plan[] = ["GROWTH", "SCALE"];
const BELOW_GROWTH: Plan[] = ["STARTER", "FREE", "TRIAL"];

describe.skipIf(!hasDb)("buyer portal: Scale gets every Growth feature", () => {
  const saved = { accounts: process.env.MANNON_FF_COMPANY_ACCOUNTS, pad: process.env.MANNON_FF_ORDERPAD };

  beforeEach(async () => {
    process.env.MANNON_FF_COMPANY_ACCOUNTS = "true";
    process.env.MANNON_FF_ORDERPAD = "true";
    resetSubmitRate();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Buyer","Company","Shop" RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    process.env.MANNON_FF_COMPANY_ACCOUNTS = saved.accounts;
    process.env.MANNON_FF_ORDERPAD = saved.pad;
    if (saved.accounts === undefined) delete process.env.MANNON_FF_COMPANY_ACCOUNTS;
    if (saved.pad === undefined) delete process.env.MANNON_FF_ORDERPAD;
    await prisma.$disconnect();
  });

  describe("team page", () => {
    it.each(GROWTH_TIER)("%s: roles and approval thresholds are on", async (plan) => {
      const { company, member } = await seed(plan);

      const data = await teamLoader(args(new Request("https://app.example.com/portal/team")));
      expect(data.isGrowth).toBe(true);

      const role = await teamAction(args(post("/portal/team", { intent: "set-role", memberId: member.id, role: "APPROVER" })));
      expect(role).toEqual({ ok: true, message: "Role updated." });
      expect((await prisma.buyer.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("APPROVER");

      const threshold = await teamAction(args(post("/portal/team", { intent: "set-threshold", threshold: "5000" })));
      expect(threshold).toEqual({ ok: true, message: "Approval threshold saved." });
      const stored = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
      expect(Number(stored.approvalThreshold)).toBe(5000);
    });

    it.each(BELOW_GROWTH)("%s: roles and approval thresholds stay off", async (plan) => {
      const { company, member } = await seed(plan);

      const data = await teamLoader(args(new Request("https://app.example.com/portal/team")));
      expect(data.isGrowth).toBe(false);

      const role = await teamAction(args(post("/portal/team", { intent: "set-role", memberId: member.id, role: "APPROVER" })));
      expect(role).toEqual({ ok: false, error: "Roles are a Growth feature." });
      expect((await prisma.buyer.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("BUYER");

      const threshold = await teamAction(args(post("/portal/team", { intent: "set-threshold", threshold: "5000" })));
      expect(threshold).toEqual({ ok: false, error: "Approval thresholds are a Growth feature." });
      expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).approvalThreshold).toBeNull();
    });
  });

  describe("quick order CSV upload", () => {
    const GROWTH_ONLY = "CSV upload is a Growth feature. Ask the store to upgrade.";

    it.each(GROWTH_TIER)("%s: the upload is accepted", async (plan) => {
      await seed(plan);
      const data = await quickLoader(args(new Request("https://app.example.com/portal/quick-order")));
      expect(data.isGrowth).toBe(true);

      const result = await quickAction(args(post("/portal/quick-order", { intent: "import-csv", csv: "sku,qty\nABC-1,2" })));
      // No store is connected in tests, so the catalog step may fail, but the
      // plan check must not be what stops it.
      expect(result).not.toMatchObject({ error: GROWTH_ONLY });
    });

    it.each(BELOW_GROWTH)("%s: the upload is refused with the plan message", async (plan) => {
      await seed(plan);
      const data = await quickLoader(args(new Request("https://app.example.com/portal/quick-order")));
      expect(data.isGrowth).toBe(false);

      const result = await quickAction(args(post("/portal/quick-order", { intent: "import-csv", csv: "sku,qty\nABC-1,2" })));
      expect(result).toEqual({ kind: "error", error: GROWTH_ONLY });
    });
  });

  describe("wholesale application auto-approval", () => {
    async function apply(plan: Plan) {
      const { shop } = await seed(plan);
      await prisma.wholesaleForm.create({
        data: {
          shopId: shop.id,
          name: "Trade application",
          published: true,
          isDefault: true,
          autoApproveDomains: ["trusted.example"],
          fields: {
            create: [
              { label: "Company name", key: "company_name", type: "TEXT", required: true, order: 0 },
              { label: "Email", key: "contact_email", type: "EMAIL", required: true, order: 1 },
            ],
          },
        },
      });
      return submitApplication(shop.shopifyDomain, {
        values: { company_name: "Trusted Trade", contact_email: "buyer@trusted.example" },
        honeypot: "",
        rateKey: `test-${plan}`,
        baseUrl: "https://app.example.com",
      });
    }

    it.each(GROWTH_TIER)("%s: an allowlisted domain is approved straight away", async (plan) => {
      expect(await apply(plan)).toEqual({ ok: true, status: "APPROVED" });
      const application = await prisma.wholesaleApplication.findFirstOrThrow({ where: { contactEmail: "buyer@trusted.example" } });
      expect(application.status).toBe("APPROVED");
      expect(application.companyId).not.toBeNull();
    });

    it.each(BELOW_GROWTH)("%s: an allowlisted domain still waits for review", async (plan) => {
      expect(await apply(plan)).toEqual({ ok: true, status: "PENDING" });
      const application = await prisma.wholesaleApplication.findFirstOrThrow({ where: { contactEmail: "buyer@trusted.example" } });
      expect(application.status).toBe("PENDING");
      expect(application.companyId).toBeNull();
    });
  });
});
