import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";
import prisma from "../db.server";
import { evaluatePriceVisibility } from "./price-visibility.server";
import { submitBuyerQuote } from "./portal-quote.server";
import { canReplyToQuote, replyLockFor } from "./plan-limits.server";
import { issueMagicLink, revokeMagicLink, verifyMagicToken } from "./magic-link.server";
import { issueApplicantSignInLink, resetSubmitRate, submitApplication } from "./wholesale.server";
import { commitRepSession, requireRepId } from "./rep-session.server";
import type { CatalogItem } from "./catalog.server";

// Phase 1 ("make today's app truthful"): what each plan does must match what
// the app says it does. These run against the test database.

const hasDb = Boolean(process.env.DATABASE_URL);
const BASE_URL = "https://app.example.com";
const tokenOf = (url: string) => new URL(url).searchParams.get("token");

async function shopWith(plan: Plan, domain = "truth.myshopify.com") {
  const shop = await prisma.shop.create({ data: { shopifyDomain: domain, plan } });
  const company = await prisma.company.create({
    data: { shopId: shop.id, shopifyCompanyId: `gid://shopify/Company/${domain}`, name: "Truth Co." },
  });
  const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: `buyer@${domain}`, name: "Ana" } });
  return { shop, company, buyer };
}

describe.skipIf(!hasDb)("Phase 1: plan truth", () => {
  beforeEach(async () => {
    vi.stubEnv("MANNON_FF_QUOTE_CAPTURE", "true");
    vi.stubEnv("MANNON_FF_WHOLESALE", "true");
    resetSubmitRate();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  describe("price rules run only while the plan includes them", () => {
    async function rules(plan: Plan) {
      const { shop } = await shopWith(plan);
      await prisma.priceVisibilityRule.create({ data: { shopId: shop.id, scope: "ALL", hidePrice: true, ctaLabel: "Ask us" } });
      await prisma.priceVisibilityRule.create({
        data: { shopId: shop.id, scope: "CUSTOMER_TAG", scopeRef: "vip", hidePrice: true, hideAtc: true, priority: 10, ctaLabel: "VIP quote" },
      });
      return shop.shopifyDomain;
    }

    it("Free: every rule is paused and shoppers see prices", async () => {
      const domain = await rules("FREE");
      expect(await evaluatePriceVisibility(domain, { loggedIn: false, customerTags: [] })).toMatchObject({ hidePrice: false, hideAtc: false });
    });

    it("Starter: broad rules run, targeted rules are paused", async () => {
      const domain = await rules("STARTER");
      expect(await evaluatePriceVisibility(domain, { loggedIn: true, customerTags: ["vip"] })).toMatchObject({
        hidePrice: true,
        hideAtc: false,
        ctaLabel: "Ask us",
      });
    });

    it("Growth: targeted rules run too", async () => {
      const domain = await rules("GROWTH");
      expect(await evaluatePriceVisibility(domain, { loggedIn: true, customerTags: ["vip"] })).toMatchObject({
        hidePrice: true,
        hideAtc: true,
        ctaLabel: "VIP quote",
      });
    });
  });

  describe("a Free store past its quote limit still receives requests", () => {
    const CATALOG: CatalogItem[] = [
      {
        variantId: "gid://shopify/ProductVariant/1",
        productId: "gid://shopify/Product/1",
        productTitle: "Widget",
        variantTitle: null,
        displayTitle: "Widget",
        sku: "W-1",
        price: "10.00",
        currencyCode: "USD",
      },
    ];

    it("saves the 11th request, and only it waits for an upgrade before a reply", async () => {
      const { buyer, company, shop } = await shopWith("FREE");
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        await prisma.quote.create({
          data: {
            companyId: company.id,
            buyerId: buyer.id,
            status: "SUBMITTED",
            createdAt: new Date(now.getTime() - (20 - i) * 60_000),
            expiresAt: new Date(now.getTime() + 7 * 86_400_000),
          },
        });
      }

      const result = await submitBuyerQuote({ id: buyer.id, companyId: company.id }, [{ variantId: CATALOG[0].variantId, quantity: 3 }], CATALOG);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const lock = await replyLockFor(shop.shopifyDomain, result.quote.id);
      expect(lock?.upgradeTo).toBe("starter");
      expect(lock?.message).toMatch(/This request is saved/);
      expect(lock?.message).toMatch(/Upgrade to Starter/);

      const first = await prisma.quote.findFirstOrThrow({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } });
      expect(await canReplyToQuote(shop.id, first)).toEqual({ allowed: true });
    });

    it("never locks replies on a paid plan", async () => {
      const { buyer, company, shop } = await shopWith("STARTER");
      const quote = await prisma.quote.create({
        data: { companyId: company.id, buyerId: buyer.id, status: "SUBMITTED", expiresAt: new Date(Date.now() + 86_400_000) },
      });
      expect(await replyLockFor(shop.shopifyDomain, quote.id)).toBeNull();
    });
  });

  describe("sign-in links don't cancel each other", () => {
    it("two links for one buyer both work, each once", async () => {
      const { buyer } = await shopWith("FREE");
      const a = await issueMagicLink(buyer.id, { baseUrl: BASE_URL, next: "/portal/quotes/a" });
      const b = await issueMagicLink(buyer.id, { baseUrl: BASE_URL, next: "/portal/quotes/b" });

      expect((await verifyMagicToken(tokenOf(a.url), { consume: false })).ok).toBe(true);
      expect((await verifyMagicToken(tokenOf(b.url), { consume: true })).ok).toBe(true);
      expect(await verifyMagicToken(tokenOf(b.url), { consume: true })).toEqual({ ok: false, reason: "invalid" });
      // Using the second link left the first one working.
      expect((await verifyMagicToken(tokenOf(a.url), { consume: true })).ok).toBe(true);
    });

    it("stores only hashes, and revoking ends every link", async () => {
      const { buyer } = await shopWith("FREE");
      const a = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
      const b = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
      const rows = await prisma.buyerSignInLink.findMany({ where: { buyerId: buyer.id } });
      expect(rows).toHaveLength(2);
      for (const raw of [tokenOf(a.url), tokenOf(b.url)]) expect(JSON.stringify(rows)).not.toContain(raw);

      await revokeMagicLink(buyer.id);
      expect((await verifyMagicToken(tokenOf(a.url))).ok).toBe(false);
      expect((await verifyMagicToken(tokenOf(b.url))).ok).toBe(false);
    });

    it("an expired link says so", async () => {
      const { buyer } = await shopWith("FREE");
      const a = await issueMagicLink(buyer.id, { baseUrl: BASE_URL, now: new Date("2020-01-01T00:00:00Z") });
      expect(await verifyMagicToken(tokenOf(a.url))).toEqual({ ok: false, reason: "expired" });
    });

    it("still accepts a link issued before per-link rows existed", async () => {
      const { buyer } = await shopWith("FREE");
      const a = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
      await prisma.buyerSignInLink.deleteMany({ where: { buyerId: buyer.id } }); // as if issued by the old code
      expect((await verifyMagicToken(tokenOf(a.url), { consume: true })).ok).toBe(true);
      expect((await verifyMagicToken(tokenOf(a.url), { consume: true })).ok).toBe(false);
    });
  });

  describe("auto-approved applicants get a way in", () => {
    it("the merchant can copy a sign-in link for an approved applicant", async () => {
      const { shop } = await shopWith("GROWTH");
      await prisma.wholesaleForm.create({
        data: {
          shopId: shop.id,
          name: "Trade",
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
      const submitted = await submitApplication(shop.shopifyDomain, {
        values: { company_name: "Trusted", contact_email: "buyer@trusted.example" },
        honeypot: "",
        rateKey: "auto",
        baseUrl: BASE_URL,
      });
      expect(submitted).toEqual({ ok: true, status: "APPROVED" });

      const application = await prisma.wholesaleApplication.findFirstOrThrow({ where: { shopId: shop.id } });
      expect(await issueApplicantSignInLink("other.myshopify.com", application.id, BASE_URL)).toBeNull();
      const link = await issueApplicantSignInLink(shop.shopifyDomain, application.id, BASE_URL);
      expect(link?.to).toBe("buyer@trusted.example");
      const verified = await verifyMagicToken(tokenOf(link!.url));
      expect(verified.ok && verified.buyer.email).toBe("buyer@trusted.example");
    });

    it("no link for an application that isn't approved", async () => {
      const { shop } = await shopWith("GROWTH");
      const application = await prisma.wholesaleApplication.create({
        data: { shopId: shop.id, companyName: "Pending Co", contactEmail: "p@pending.example", answers: {}, status: "PENDING", tags: [] },
      });
      expect(await issueApplicantSignInLink(shop.shopifyDomain, application.id, BASE_URL)).toBeNull();
    });
  });

  describe("the rep portal follows the Scale plan", () => {
    // A signed-in rep: a real session cookie, as the sign-in route sets it.
    async function repOn(plan: Plan) {
      const { shop } = await shopWith(plan);
      const rep = await prisma.salesRep.create({ data: { shopId: shop.id, email: "rep@truth.example", status: "ACTIVE" } });
      const cookie = (await commitRepSession(rep.id)).split(";")[0];
      return { repId: rep.id, request: new Request(`${BASE_URL}/rep`, { headers: { Cookie: cookie } }) };
    }

    it("lets a rep in on Scale", async () => {
      const { repId, request } = await repOn("SCALE");
      await expect(requireRepId(request)).resolves.toBe(repId);
    });

    it.each(["GROWTH", "STARTER", "FREE"] as const)("turns a rep away on %s with a 402", async (plan) => {
      const { request } = await repOn(plan);
      const error = await requireRepId(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(402);
    });
  });
});
