import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import prisma from "../db.server";
import { listPriceRules, savePriceRule, deletePriceRule, evaluatePriceVisibility, ScopeNotAllowedError } from "./price-visibility.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("price-visibility.server (DB)", () => {
  beforeEach(async () => {
    vi.stubEnv("MANNON_FF_QUOTE_CAPTURE", "true");
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PriceVisibilityRule","Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

  const starter = () => prisma.shop.create({ data: { shopifyDomain: "pv.myshopify.com", plan: "STARTER" } });
  const growth = () => prisma.shop.create({ data: { shopifyDomain: "pv.myshopify.com", plan: "GROWTH" } });

  it("Starter can gate logged-out; targeted scopes are rejected", async () => {
    await starter();
    const r = await savePriceRule("pv.myshopify.com", { scope: "LOGGED_OUT", hidePrice: true, hideAtc: true, ctaLabel: "Get a quote" });
    expect(r).toHaveProperty("id");
    expect(await listPriceRules("pv.myshopify.com")).toHaveLength(1);
    await expect(savePriceRule("pv.myshopify.com", { scope: "PRODUCT", scopeRef: "gid://p/1", hidePrice: true, hideAtc: false })).rejects.toBeInstanceOf(ScopeNotAllowedError);
  });

  it("requires a reference for targeted scopes (Growth)", async () => {
    await growth();
    expect(await savePriceRule("pv.myshopify.com", { scope: "CUSTOMER_TAG", hidePrice: true, hideAtc: false })).toEqual({ error: expect.any(String) });
    expect(await savePriceRule("pv.myshopify.com", { scope: "CUSTOMER_TAG", scopeRef: "wholesale", hidePrice: true, hideAtc: false })).toHaveProperty("id");
  });

  it("evaluates a decision that hides price for logged-out — and never returns a price", async () => {
    await starter();
    await savePriceRule("pv.myshopify.com", { scope: "LOGGED_OUT", hidePrice: true, hideAtc: true, ctaLabel: "Ask us" });
    const anon = await evaluatePriceVisibility("pv.myshopify.com", { loggedIn: false });
    expect(anon).toEqual({ hidePrice: true, hideAtc: true, ctaLabel: "Ask us" });
    expect(Object.keys(anon)).not.toContain("price"); // §5.2 — no price in the decision
    const known = await evaluatePriceVisibility("pv.myshopify.com", { loggedIn: true });
    expect(known).toEqual({ hidePrice: false, hideAtc: false, ctaLabel: null });
  });

  it("deletes a rule", async () => {
    await starter();
    const r = await savePriceRule("pv.myshopify.com", { scope: "ALL", hidePrice: true, hideAtc: false });
    await deletePriceRule("pv.myshopify.com", (r as { id: string }).id);
    expect(await listPriceRules("pv.myshopify.com")).toHaveLength(0);
  });
});
