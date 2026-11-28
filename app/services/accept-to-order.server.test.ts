import { afterAll, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { acceptAndOrder, TotalsChangedError } from "./quote-accept.server";
import { convertQuoteToOrder, QuoteConvertError } from "./quote-convert.server";
import { OrderInProgressError, QuoteAlreadyOrderedError, CLAIM_STALE_MS } from "./order-claim.server";
import type { AdminGraphqlClient } from "./draft-order.server";
import { counterQuote, submitQuote } from "./quote.server";

// Phase 3: accept → order. A double accept creates one Shopify draft order;
// a total that changed since the quote was sent is confirmed by the buyer
// first; Shopify being unreachable leaves the quote as it was, ready to retry.
const hasDb = Boolean(process.env.DATABASE_URL);
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const totals = (total: string) => ({ subtotalPriceSet: money("90.00"), totalTaxSet: money("9.00"), totalPriceSet: money(total) });

function shopify(opts: { total?: string; down?: boolean; slowCreateMs?: number } = {}) {
  const created: string[] = [];
  let n = 0;
  const admin: AdminGraphqlClient = {
    graphql: async (query) => {
      if (opts.down) throw new Error("getaddrinfo ENOTFOUND shop.myshopify.com");
      if (query.includes("draftOrderCalculate")) {
        return { json: async () => ({ data: { draftOrderCalculate: { calculatedDraftOrder: totals(opts.total ?? "99.00"), userErrors: [] } } }) };
      }
      if (query.includes("draftOrderInvoiceSend")) {
        return { json: async () => ({ data: { draftOrderInvoiceSend: { draftOrder: { id: "x" }, userErrors: [] } } }) };
      }
      // draftOrderCreate
      if (opts.slowCreateMs) await new Promise((r) => setTimeout(r, opts.slowCreateMs));
      const id = `gid://shopify/DraftOrder/${700 + n++}`;
      created.push(id);
      return { json: async () => ({ data: { draftOrderCreate: { draftOrder: { id, ...totals(opts.total ?? "99.00") }, userErrors: [] } } }) };
    },
  };
  return { admin, created };
}

async function sentQuote(sentTotal = "99.00") {
  const shop = await prisma.shop.create({ data: { shopifyDomain: "a2o.myshopify.com", quoteExpiryDays: 14 } });
  const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/31", name: "A2O Co." } });
  const buyer = await prisma.buyer.create({
    data: { companyId: company.id, email: "a2o@buyer.example", shopifyContactId: "gid://shopify/CompanyContact/31", shopifyCompanyLocationId: "gid://shopify/CompanyLocation/31" },
  });
  const quote = await submitQuote({ companyId: company.id, buyerId: buyer.id, lines: [{ variantId: "gid://v/1", title: "Widget", quantity: 10, price: "9.00" }] });
  // Sent with Shopify's totals at the time.
  await counterQuote(quote.id, { data: { totalsSnapshot: { subtotal: "90.00", totalTax: "9.00", total: sentTotal, currencyCode: "USD" } } });
  return { quote };
}

describe.skipIf(!hasDb)("accept to order", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a double accept creates one draft order", async () => {
    const { quote } = await sentQuote();
    const { admin, created } = shopify({ slowCreateMs: 50 });
    const results = await Promise.allSettled([
      acceptAndOrder(quote.id, admin, { currencyCode: "USD" }),
      acceptAndOrder(quote.id, admin, { currencyCode: "USD" }),
    ]);
    expect(created).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OrderInProgressError);
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect([after.status, after.draftOrderId, after.orderingSince]).toEqual(["ORDERED", created[0], null]);
    // Accepting again later is "already an order", not a second one.
    await expect(acceptAndOrder(quote.id, admin, { currencyCode: "USD" })).rejects.toBeInstanceOf(QuoteAlreadyOrderedError);
    expect(created).toHaveLength(1);
  });

  it("the buyer accepting while the merchant converts gives one order", async () => {
    const { quote } = await sentQuote();
    const { admin, created } = shopify({ slowCreateMs: 50 });
    const results = await Promise.allSettled([
      acceptAndOrder(quote.id, admin, { currencyCode: "USD" }),
      convertQuoteToOrder(quote.id, admin, { currencyCode: "USD", sendInvoice: false }),
    ]);
    expect(created).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.constructor)).toEqual(
      [expect.anything()],
    );
    const loser = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    expect(loser instanceof OrderInProgressError || loser instanceof QuoteConvertError).toBe(true);
  });

  it("asks the buyer to confirm when Shopify's total changed since the quote was sent", async () => {
    const { quote } = await sentQuote("99.00");
    const { admin, created } = shopify({ total: "104.50" });
    const err = await acceptAndOrder(quote.id, admin, { currencyCode: "USD" }).catch((e) => e);
    expect(err).toBeInstanceOf(TotalsChangedError);
    expect([(err as TotalsChangedError).was.total, (err as TotalsChangedError).now.total]).toEqual(["99.00", "104.50"]);
    expect(created).toHaveLength(0);
    const waiting = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect([waiting.status, waiting.orderingSince]).toEqual(["COUNTERED", null]);

    // Confirming an outdated amount asks again; confirming Shopify's total places the order.
    await expect(acceptAndOrder(quote.id, admin, { currencyCode: "USD", confirmedTotal: "103.00" })).rejects.toBeInstanceOf(TotalsChangedError);
    const done = await acceptAndOrder(quote.id, admin, { currencyCode: "USD", confirmedTotal: "104.50" });
    expect(done.totals.total).toBe("104.50");
    expect(created).toHaveLength(1);
  });

  it("an unchanged total needs no extra confirmation", async () => {
    const { quote } = await sentQuote("99.00");
    const { admin, created } = shopify({ total: "99.0" });
    await acceptAndOrder(quote.id, admin, { currencyCode: "USD" });
    expect(created).toHaveLength(1);
  });

  it("when Shopify is unreachable nothing changes, and the buyer can try again", async () => {
    const { quote } = await sentQuote();
    await expect(acceptAndOrder(quote.id, shopify({ down: true }).admin, { currencyCode: "USD" })).rejects.toThrow(/ENOTFOUND/);
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect([after.status, after.draftOrderId, after.orderingSince]).toEqual(["COUNTERED", null, null]);
    const { admin, created } = shopify();
    await acceptAndOrder(quote.id, admin, { currencyCode: "USD" });
    expect(created).toHaveLength(1);
  });

  it("a claim left by a crash expires", async () => {
    const { quote } = await sentQuote();
    await prisma.quote.update({ where: { id: quote.id }, data: { orderingSince: new Date(Date.now() - CLAIM_STALE_MS - 1000) } });
    const { admin, created } = shopify();
    await acceptAndOrder(quote.id, admin, { currencyCode: "USD" });
    expect(created).toHaveLength(1);
  });
});
