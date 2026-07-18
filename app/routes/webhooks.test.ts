import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { computeHmac } from "../lib/hmac.server";
import { action as dataRequest } from "./webhooks.customers.data_request";
import { action as customersRedact } from "./webhooks.customers.redact";
import { action as shopRedact } from "./webhooks.shop.redact";
import { action as appUninstalled } from "./webhooks.app.uninstalled";

const hasDb = Boolean(process.env.DATABASE_URL);
const SECRET = "shpss_webhook_test_secret";

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = SECRET;
});

function webhookRequest(
  url: string,
  body: unknown,
  opts: { sign: boolean | "wrong"; shop?: string; topic?: string } = { sign: true },
): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {
    "X-Shopify-Shop-Domain": opts.shop ?? "s.myshopify.com",
    "X-Shopify-Topic": opts.topic ?? "",
  };
  if (opts.sign === true) headers["X-Shopify-Hmac-Sha256"] = computeHmac(raw, SECRET);
  else if (opts.sign === "wrong") headers["X-Shopify-Hmac-Sha256"] = "not-a-valid-hmac";
  return new Request(url, { method: "POST", body: raw, headers });
}

const args = (request: Request) => ({ request, params: {}, context: {} }) as never;

describe("webhook HMAC rejection (no DB needed)", () => {
  const cases: Array<[string, (a: never) => Promise<Response>, unknown]> = [
    ["customers/data_request", dataRequest, { shop_domain: "s.myshopify.com", customer: { email: "x@y.com" } }],
    ["customers/redact", customersRedact, { shop_domain: "s.myshopify.com", customer: { email: "x@y.com" } }],
    ["shop/redact", shopRedact, { shop_domain: "s.myshopify.com" }],
    ["app/uninstalled", appUninstalled, {}],
  ];

  for (const [name, action, body] of cases) {
    it(`${name}: rejects a missing signature with 401`, async () => {
      const res = await action(args(webhookRequest(`https://app.example.com/webhooks/${name}`, body, { sign: false })));
      expect(res.status).toBe(401);
    });
    it(`${name}: rejects a wrong signature with 401`, async () => {
      const res = await action(args(webhookRequest(`https://app.example.com/webhooks/${name}`, body, { sign: "wrong" })));
      expect(res.status).toBe(401);
    });
  }
});

describe.skipIf(!hasDb)("webhook signed payloads perform their work", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","QuoteLine","Quote","ReorderSource","Buyer","Company","Shop","Session" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(domain: string, email: string) {
    const shop = await prisma.shop.create({ data: { shopifyDomain: domain } });
    const company = await prisma.company.create({
      data: { shopId: shop.id, shopifyCompanyId: `gid://c/${domain}`, name: "Co" },
    });
    await prisma.buyer.create({ data: { companyId: company.id, email } });
    await prisma.session.create({
      data: { id: `offline_${domain}`, shop: domain, state: "s", accessToken: "t" },
    });
  }

  it("shop/redact (signed) deletes the shop; unsigned leaves it", async () => {
    await seed("a.myshopify.com", "a@x.com");

    const unsigned = await shopRedact(
      args(webhookRequest("https://app.example.com/webhooks/shop/redact", { shop_domain: "a.myshopify.com" }, { sign: false })),
    );
    expect(unsigned.status).toBe(401);
    expect(await prisma.shop.count()).toBe(1); // still there

    const signed = await shopRedact(
      args(webhookRequest("https://app.example.com/webhooks/shop/redact", { shop_domain: "a.myshopify.com" }, { sign: true })),
    );
    expect(signed.status).toBe(200);
    expect(await prisma.shop.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it("customers/redact (signed) deletes the buyer", async () => {
    await seed("a.myshopify.com", "target@x.com");
    const res = await customersRedact(
      args(
        webhookRequest(
          "https://app.example.com/webhooks/customers/redact",
          { shop_domain: "a.myshopify.com", customer: { email: "target@x.com" } },
          { sign: true },
        ),
      ),
    );
    expect(res.status).toBe(200);
    expect(await prisma.buyer.findFirst({ where: { email: "target@x.com" } })).toBeNull();
  });

  it("app/uninstalled (signed) clears the shop's sessions but keeps data", async () => {
    await seed("a.myshopify.com", "a@x.com");
    const res = await appUninstalled(
      args(
        webhookRequest(
          "https://app.example.com/webhooks/app/uninstalled",
          { myshopify_domain: "a.myshopify.com" },
          { sign: true, shop: "a.myshopify.com" },
        ),
      ),
    );
    expect(res.status).toBe(200);
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.shop.count()).toBe(1);
  });

  it("customers/data_request (signed) acknowledges with 200", async () => {
    await seed("a.myshopify.com", "a@x.com");
    const res = await dataRequest(
      args(
        webhookRequest(
          "https://app.example.com/webhooks/customers/data_request",
          { shop_domain: "a.myshopify.com", customer: { email: "a@x.com" } },
          { sign: true },
        ),
      ),
    );
    expect(res.status).toBe(200);
  });
});
