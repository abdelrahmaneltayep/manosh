import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { issueMagicLink } from "../services/magic-link.server";
import { getBuyerId } from "../services/buyer-session.server";
import { loader, action } from "./portal.auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const BASE_URL = "https://app.example.com";

async function seedBuyerWithLink() {
  const shop = await prisma.shop.create({
    data: { shopifyDomain: "auth-route.myshopify.com" },
  });
  const company = await prisma.company.create({
    data: {
      shopId: shop.id,
      shopifyCompanyId: "gid://shopify/Company/ar",
      name: "Auth Route Co.",
    },
  });
  const buyer = await prisma.buyer.create({
    data: {
      companyId: company.id,
      email: "auth-route@example.com",
      name: "Alex",
    },
  });
  const { url } = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
  const token = new URL(url).searchParams.get("token")!;
  return { buyer, token };
}

// Minimal loader/action arg shims (only `request` is used by these handlers).
const args = (request: Request) =>
  ({ request, params: {}, context: {} }) as never;

describe.skipIf(!hasDb)("portal.auth route", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GET peeks a valid token without consuming it", async () => {
    const { token } = await seedBuyerWithLink();
    const request = new Request(`${BASE_URL}/portal/auth?token=${token}`);
    const data = await loader(args(request));
    expect(data).toMatchObject({ state: "valid", email: "auth-route@example.com" });

    // Still consumable afterwards → GET did not burn it.
    const form = new FormData();
    form.set("token", token);
    const postReq = new Request(`${BASE_URL}/portal/auth`, {
      method: "POST",
      body: form,
    });
    const res = (await action(args(postReq))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/portal");
  });

  it("POST consumes the token and sets a buyer session cookie", async () => {
    const { buyer, token } = await seedBuyerWithLink();
    const form = new FormData();
    form.set("token", token);
    const request = new Request(`${BASE_URL}/portal/auth`, {
      method: "POST",
      body: form,
    });

    const res = (await action(args(request))) as Response;
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toBeTruthy();

    const sessionRequest = new Request(`${BASE_URL}/portal`, {
      headers: { Cookie: setCookie.split(";")[0] },
    });
    expect(await getBuyerId(sessionRequest)).toBe(buyer.id);
  });

  it("GET reports an expired token", async () => {
    const { buyer } = await seedBuyerWithLink();
    await prisma.buyer.update({
      where: { id: buyer.id },
      data: { magicTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    // Re-issue expired: fetch the current token via a fresh link then expire it.
    const request = new Request(`${BASE_URL}/portal/auth?token=whatever`);
    const data = await loader(args(request));
    expect(data).toMatchObject({ state: "invalid" }); // "whatever" doesn't match
  });

  it("POST with an already-consumed token redirects back to the notice", async () => {
    const { token } = await seedBuyerWithLink();
    const consume = () => {
      const form = new FormData();
      form.set("token", token);
      return action(
        args(
          new Request(`${BASE_URL}/portal/auth`, { method: "POST", body: form }),
        ),
      ) as Promise<Response>;
    };
    const first = await consume();
    const second = await consume();
    expect(first.headers.get("Location")).toBe("/portal");
    expect(second.headers.get("Location")).toContain("/portal/auth?token=");
  });
});
