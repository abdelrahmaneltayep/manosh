import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  BUYER_COMPANY_LINK_QUERY,
  buyerLinkMessages,
  ensureBuyerCompanyLink,
  exactEmailQuery,
  pickCompanyLink,
} from "./buyer-link.server";
import type { AdminGraphqlClient } from "./draft-order.server";

const hasDb = Boolean(process.env.DATABASE_URL);

const profile = (contact: string, company: string, name: string, locations: string[]) => ({
  id: `gid://shopify/CompanyContact/${contact}`,
  company: { id: `gid://shopify/Company/${company}`, name },
  roleAssignments: { nodes: locations.map((l) => ({ companyLocation: { id: `gid://shopify/CompanyLocation/${l}`, name: `Loc ${l}` } })) },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lookup = (profiles: any[] | null) => ({ customers: { nodes: profiles === null ? [] : [{ id: "gid://shopify/Customer/9", companyContactProfiles: profiles }] } });

describe("exactEmailQuery", () => {
  it("quotes the email so Shopify matches it exactly", () => {
    expect(exactEmailQuery(" Jo@Acme.example ")).toBe('email:"Jo@Acme.example"');
  });
  it("escapes quotes and backslashes", () => {
    expect(exactEmailQuery('a"b\\c@x.io')).toBe('email:"a\\"b\\\\c@x.io"');
  });
});

describe("pickCompanyLink (pure)", () => {
  it("no customer → no-customer", () => {
    expect(pickCompanyLink(lookup(null), null)).toEqual({ problem: "no-customer" });
  });
  it("a customer who is not a company contact → not-a-contact", () => {
    expect(pickCompanyLink(lookup([]), null)).toEqual({ problem: "not-a-contact" });
  });
  it("takes the first profile with a location role", () => {
    const r = pickCompanyLink(lookup([profile("1", "10", "No Loc Co", []), profile("2", "20", "Acme", ["200", "201"])]), null);
    expect(r).toEqual({ link: { companyId: "gid://shopify/Company/20", companyLocationId: "gid://shopify/CompanyLocation/200", companyContactId: "gid://shopify/CompanyContact/2" }, companyName: "Acme" });
  });
  it("prefers the quote's company when it is a real Shopify company", () => {
    const r = pickCompanyLink(lookup([profile("1", "10", "Other", ["100"]), profile("2", "20", "Acme", ["200"])]), "gid://shopify/Company/20");
    expect("link" in r && r.link.companyContactId).toBe("gid://shopify/CompanyContact/2");
  });
  it("a contact only at a different company → other-company", () => {
    expect(pickCompanyLink(lookup([profile("1", "10", "Other", ["100"])]), "gid://shopify/Company/20")).toEqual({ problem: "other-company", companyName: "Other" });
  });
  it("a contact without any location role → no-location", () => {
    expect(pickCompanyLink(lookup([profile("1", "10", "Acme", [])]), null)).toEqual({ problem: "no-location", companyName: "Acme" });
  });
});

describe("buyerLinkMessages", () => {
  it("tells the merchant what to set up in Shopify, and the buyer to contact their supplier", () => {
    const m = buyerLinkMessages("no-location", "jo@acme.example", "Acme");
    expect(m.merchantMessage).toContain("Customers → Companies");
    expect(m.merchantMessage).toContain("at Acme");
    expect(m.buyerMessage).toMatch(/contact your supplier/);
  });
});

function fakeAdmin(data: unknown, calls: Array<{ query: string; q?: unknown }>, fail = false): AdminGraphqlClient {
  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, q: options?.variables?.q });
      if (fail) throw new Error("network down");
      return { json: async () => ({ data }) };
    },
  };
}

describe.skipIf(!hasDb)("ensureBuyerCompanyLink (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Buyer","Company","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(opts: { companyGid: string; contact?: string | null; location?: string | null }) {
    const shop = await prisma.shop.create({ data: { shopifyDomain: "link.myshopify.com" } });
    const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: opts.companyGid, name: "Acme" } });
    const buyer = await prisma.buyer.create({
      data: { companyId: company.id, email: "jo@acme.example", shopifyContactId: opts.contact ?? null, shopifyCompanyLocationId: opts.location ?? null },
    });
    return { shop, company, buyer };
  }

  it("uses the stored link without calling Shopify", async () => {
    const { buyer } = await seed({ companyGid: "gid://shopify/Company/20", contact: "gid://shopify/CompanyContact/2", location: "gid://shopify/CompanyLocation/200" });
    const calls: Array<{ query: string }> = [];
    const r = await ensureBuyerCompanyLink(fakeAdmin({}, calls), buyer.id);
    expect(r).toEqual({ ok: true, linkedNow: false, link: { companyId: "gid://shopify/Company/20", companyLocationId: "gid://shopify/CompanyLocation/200", companyContactId: "gid://shopify/CompanyContact/2" } });
    expect(calls).toHaveLength(0);
  });

  it("links a storefront buyer from Shopify and replaces the placeholder company id", async () => {
    const { buyer, company } = await seed({ companyGid: "quote-request:abc" });
    const calls: Array<{ query: string; q?: unknown }> = [];
    const r = await ensureBuyerCompanyLink(fakeAdmin(lookup([profile("2", "20", "Acme", ["200"])]), calls), buyer.id);
    expect(r.ok && r.linkedNow).toBe(true);
    expect(calls[0].query).toBe(BUYER_COMPANY_LINK_QUERY);
    expect(calls[0].q).toBe('email:"jo@acme.example"');
    const b = await prisma.buyer.findUniqueOrThrow({ where: { id: buyer.id } });
    expect([b.shopifyContactId, b.shopifyCompanyLocationId]).toEqual(["gid://shopify/CompanyContact/2", "gid://shopify/CompanyLocation/200"]);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).shopifyCompanyId).toBe("gid://shopify/Company/20");
  });

  it("keeps the placeholder when another company row already holds the Shopify company", async () => {
    const { buyer, company, shop } = await seed({ companyGid: "wholesale:app1" });
    await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/20", name: "Acme (synced)" } });
    const r = await ensureBuyerCompanyLink(fakeAdmin(lookup([profile("2", "20", "Acme", ["200"])]), []), buyer.id);
    expect(r.ok && r.link.companyId).toBe("gid://shopify/Company/20");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).shopifyCompanyId).toBe("wholesale:app1");
  });

  it("explains what's missing when Shopify has no company contact", async () => {
    const { buyer } = await seed({ companyGid: "quote-request:abc" });
    const r = await ensureBuyerCompanyLink(fakeAdmin(lookup([]), []), buyer.id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not-a-contact");
      expect(r.merchantMessage).toContain("jo@acme.example");
    }
    const b = await prisma.buyer.findUniqueOrThrow({ where: { id: buyer.id } });
    expect(b.shopifyCompanyLocationId).toBeNull();
  });

  it("reports Shopify being unavailable without changing anything", async () => {
    const { buyer } = await seed({ companyGid: "quote-request:abc" });
    const r = await ensureBuyerCompanyLink(fakeAdmin(null, [], true), buyer.id);
    expect(r.ok === false && r.reason).toBe("unavailable");
  });
});
