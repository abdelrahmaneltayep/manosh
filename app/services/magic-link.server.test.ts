import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  generateMagicToken,
  hashToken,
  issueMagicLink,
  revokeMagicLink,
  verifyMagicToken,
} from "./magic-link.server";

const hasDb = Boolean(process.env.DATABASE_URL);
const BASE_URL = "https://app.example.com";

async function makeBuyer() {
  const shop = await prisma.shop.create({
    data: { shopifyDomain: "magic-test.myshopify.com", magicLinkExpiryDays: 7 },
  });
  const company = await prisma.company.create({
    data: {
      shopId: shop.id,
      shopifyCompanyId: "gid://shopify/Company/ml",
      name: "Magic Co.",
    },
  });
  const buyer = await prisma.buyer.create({
    data: {
      companyId: company.id,
      email: "ml-buyer@example.com",
      name: "Morgan",
    },
  });
  return { shop, company, buyer };
}

describe("token hashing (pure)", () => {
  it("hashToken is deterministic and one-way (never returns the raw)", () => {
    const raw = "some-raw-token";
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).not.toBe(raw);
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateMagicToken returns a raw token whose hash matches", () => {
    const { raw, hash } = generateMagicToken();
    expect(raw).not.toBe(hash);
    expect(hash).toBe(hashToken(raw));
    expect(raw.length).toBeGreaterThanOrEqual(32);
  });
});

describe.skipIf(!hasDb)("magic link issue / verify / revoke", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores ONLY the hash, never the raw token", async () => {
    const { buyer } = await makeBuyer();
    const { url } = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });

    const raw = new URL(url).searchParams.get("token")!;
    expect(raw).toBeTruthy();

    const stored = await prisma.buyer.findUnique({ where: { id: buyer.id } });
    expect(stored!.magicTokenHash).toBe(hashToken(raw));
    expect(stored!.magicTokenHash).not.toBe(raw);
    expect(stored!.magicTokenExpiresAt).toBeInstanceOf(Date);
  });

  it("uses the shop's magicLinkExpiryDays for the expiry", async () => {
    const { shop, buyer } = await makeBuyer();
    await prisma.shop.update({
      where: { id: shop.id },
      data: { magicLinkExpiryDays: 3 },
    });
    const now = new Date("2026-07-18T00:00:00Z");
    const { expiresAt } = await issueMagicLink(buyer.id, {
      baseUrl: BASE_URL,
      now,
    });
    const expectedDays = (expiresAt.getTime() - now.getTime()) / 86_400_000;
    expect(Math.round(expectedDays)).toBe(3);
  });

  it("verifies a valid token (peek does not consume)", async () => {
    const { buyer } = await makeBuyer();
    const { url } = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
    const raw = new URL(url).searchParams.get("token")!;

    const peek1 = await verifyMagicToken(raw, { consume: false });
    const peek2 = await verifyMagicToken(raw, { consume: false });
    expect(peek1.ok).toBe(true);
    expect(peek2.ok).toBe(true);
    if (peek1.ok) expect(peek1.buyer.id).toBe(buyer.id);
  });

  it("consumes a token single-use — a second consume is rejected", async () => {
    const { buyer } = await makeBuyer();
    const { url } = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
    const raw = new URL(url).searchParams.get("token")!;

    const first = await verifyMagicToken(raw, { consume: true });
    const second = await verifyMagicToken(raw, { consume: true });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("invalid");

    const stored = await prisma.buyer.findUnique({ where: { id: buyer.id } });
    expect(stored!.magicTokenHash).toBeNull();
    expect(stored!.magicTokenExpiresAt).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { buyer } = await makeBuyer();
    const past = new Date(Date.now() - 60_000);
    await prisma.buyer.update({
      where: { id: buyer.id },
      data: { magicTokenHash: hashToken("expired-raw"), magicTokenExpiresAt: past },
    });
    const result = await verifyMagicToken("expired-raw", { consume: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects an unknown/garbage token", async () => {
    await makeBuyer();
    const result = await verifyMagicToken("not-a-real-token", { consume: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("rejects an empty token", async () => {
    const result = await verifyMagicToken("", { consume: true });
    expect(result.ok).toBe(false);
  });

  it("revokeMagicLink invalidates an outstanding link", async () => {
    const { buyer } = await makeBuyer();
    const { url } = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
    const raw = new URL(url).searchParams.get("token")!;

    await revokeMagicLink(buyer.id);

    const result = await verifyMagicToken(raw, { consume: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("only one of two concurrent consumes wins (race-safe)", async () => {
    const { buyer } = await makeBuyer();
    const { url } = await issueMagicLink(buyer.id, { baseUrl: BASE_URL });
    const raw = new URL(url).searchParams.get("token")!;

    const [a, b] = await Promise.all([
      verifyMagicToken(raw, { consume: true }),
      verifyMagicToken(raw, { consume: true }),
    ]);
    const wins = [a.ok, b.ok].filter(Boolean).length;
    expect(wins).toBe(1);
  });
});
