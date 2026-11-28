import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "../db.server";
import { emailDeliveryEnabled, sendEmail, setMailTransport, type EmailMessage } from "./mailer.server";
import { alertMerchant, ensureAlertEmails, merchantAlertAddresses, parseAlertEmails } from "./merchant-alerts.server";
import { emailQuoteOrdered, emailQuoteReceived, emailQuoteSent } from "./quote-emails.server";
import { dispatchForShop, rescheduleExpiryWarnings, upsertPolicy } from "./followups.server";
import { verifyMagicToken } from "./magic-link.server";
import { redactCustomer } from "./gdpr.server";
import { storeName } from "./shop-name.server";

// Phase 2: email that actually sends. Postmark is replaced by a recording
// transport; MANNON_MAIL_FROM is the sender.
const hasDb = Boolean(process.env.DATABASE_URL);
const BASE_URL = "https://app.example.com";
let outbox: EmailMessage[] = [];
let failNext = false;

function connectSender() {
  vi.stubEnv("MANNON_MAIL_FROM", "quotes@support-mannon.com");
  setMailTransport(async (message) => {
    if (failNext) {
      failNext = false;
      throw new Error("Inactive recipient");
    }
    outbox.push(message);
    return { messageId: `m-${outbox.length}` };
  });
}

async function seed(alertEmails: string[] = ["owner@store.example"]) {
  const shop = await prisma.shop.create({ data: { shopifyDomain: "mail.myshopify.com", name: "Mail Supply Co.", plan: "GROWTH", alertEmails } });
  const company = await prisma.company.create({ data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/m", name: "Mail Co." } });
  const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "buyer@mail.example", name: "Ana" } });
  const quote = await prisma.quote.create({
    data: { companyId: company.id, buyerId: buyer.id, status: "SUBMITTED", expiresAt: new Date(Date.now() + 10 * 86_400_000) },
  });
  return { shop, company, buyer, quote };
}

describe("store name in emails", () => {
  it("uses the name from Shopify, else the domain without .myshopify.com", () => {
    expect(storeName("harbor.myshopify.com", "Harbor Coffee")).toBe("Harbor Coffee");
    expect(storeName("harbor.myshopify.com", "  ")).toBe("harbor");
    expect(storeName("harbor.myshopify.com", null)).toBe("harbor");
  });
});

describe("alert addresses", () => {
  it("parses commas, spaces and new lines, and rejects junk", () => {
    expect(parseAlertEmails("A@x.co, b@y.co\nnot-an-email")).toEqual({ emails: ["a@x.co", "b@y.co"], invalid: ["not-an-email"] });
  });
});

describe.skipIf(!hasDb)("Phase 2 email", () => {
  beforeEach(async () => {
    outbox = [];
    failNext = false;
    connectSender();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterEach(() => {
    setMailTransport(null);
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("delivery is on only with a sender address and a provider", () => {
    expect(emailDeliveryEnabled()).toBe(true);
    vi.stubEnv("MANNON_MAIL_FROM", "");
    expect(emailDeliveryEnabled()).toBe(false);
  });

  it("logs sent and failed sends against what they were about", async () => {
    const { shop, quote } = await seed();
    const meta = { shopId: shop.id, template: "quote_sent", entityType: "Quote", entityId: quote.id };
    expect(await sendEmail({ to: "a@b.co", subject: "s", html: "h" }, meta)).toEqual({ sent: true });
    failNext = true;
    expect(await sendEmail({ to: "a@b.co", subject: "s", html: "h" }, meta)).toEqual({ sent: false, error: "Inactive recipient" });
    const rows = await prisma.emailDelivery.findMany({ where: { entityId: quote.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.status, r.error, r.providerMessageId])).toEqual([
      ["SENT", null, "m-1"],
      ["FAILED", "Inactive recipient", null],
    ]);
  });

  it("logs a skipped send when no sender is connected", async () => {
    const { shop } = await seed();
    setMailTransport(null);
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    expect(await sendEmail({ to: "a@b.co", subject: "s", html: "h" }, { shopId: shop.id })).toEqual({ sent: false, skipped: "unconfigured" });
    expect((await prisma.emailDelivery.findFirstOrThrow({ where: { shopId: shop.id } })).status).toBe("SKIPPED");
  });

  it("fills the store name and alert address from Shopify, at most once a day", async () => {
    await prisma.shop.create({ data: { shopifyDomain: "fresh.myshopify.com" } });
    let calls = 0;
    const admin = {
      graphql: async () => {
        calls++;
        return new Response(JSON.stringify({ data: { shop: { name: "Fresh Foods", contactEmail: "Hello@Fresh.example", email: "x@y.co" } } }));
      },
    };
    await ensureAlertEmails("fresh.myshopify.com", admin);
    await ensureAlertEmails("fresh.myshopify.com", admin);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { shopifyDomain: "fresh.myshopify.com" } });
    expect([shop.name, shop.alertEmails, calls]).toEqual(["Fresh Foods", ["hello@fresh.example"], 1]);
  });

  it("alerts go to the store's own addresses", async () => {
    await seed(["owner@store.example", "ops@store.example"]);
    expect(await merchantAlertAddresses("mail.myshopify.com")).toEqual(["owner@store.example", "ops@store.example"]);
    await alertMerchant("mail.myshopify.com", { subject: "New request", text: "Hi" });
    expect(outbox.map((m) => m.to)).toEqual(["owner@store.example", "ops@store.example"]);
  });

  it("a portal quote alerts the merchant and confirms to the buyer", async () => {
    const { quote } = await seed();
    await emailQuoteReceived(quote.id, BASE_URL);
    expect(outbox.map((m) => m.to)).toEqual(["owner@store.example", "buyer@mail.example"]);
    expect(outbox[0].text).toContain(`${BASE_URL}/app/quotes/${quote.id}`);
  });

  it("the priced quote reaches the buyer with a sign-in link that opens it", async () => {
    const { quote } = await seed();
    const sent = await emailQuoteSent(quote.id, BASE_URL);
    expect(sent?.result.sent).toBe(true);
    const email = outbox[0];
    expect(email.to).toBe("buyer@mail.example");
    expect(email.fromName).toBe("Mail Supply Co.");
    expect(email.subject).toBe("Your quote from Mail Supply Co. is ready");
    const link = email.text?.match(/https:\/\/app\.example\.com\/portal\/auth\?\S+/)?.[0];
    expect(link).toBeTruthy();
    expect(new URL(link!).searchParams.get("next")).toBe(`/portal/quotes/${quote.id}`);
    expect((await verifyMagicToken(new URL(link!).searchParams.get("token"))).ok).toBe(true);
  });

  it("when the send fails, the merchant still gets a working link and the failure is logged", async () => {
    const { quote } = await seed();
    failNext = true;
    const sent = await emailQuoteSent(quote.id, BASE_URL);
    expect(sent?.result).toEqual({ sent: false, error: "Inactive recipient" });
    expect(sent?.link?.url).toMatch(/\/portal\/auth\?token=/);
    expect((await prisma.emailDelivery.findFirstOrThrow({ where: { entityId: quote.id } })).status).toBe("FAILED");
  });

  it("buyer replies reach the store, never Mannon's sending address", async () => {
    const { quote } = await seed(["owner@store.example", "ops@store.example"]);
    await emailQuoteReceived(quote.id, BASE_URL);
    await emailQuoteSent(quote.id, BASE_URL);
    await emailQuoteOrdered(quote.id, BASE_URL);
    const toBuyer = outbox.filter((m) => m.to === "buyer@mail.example");
    expect(toBuyer).toHaveLength(3);
    for (const m of toBuyer) {
      expect(m.replyTo).toBe("owner@store.example");
      expect(m.replyTo).not.toBe(process.env.MANNON_MAIL_FROM);
      expect(m.fromName).toBe("Mail Supply Co.");
    }
  });

  it("follow-up and expiry reminders reply to the store too", async () => {
    const { quote } = await seed();
    await upsertPolicy("mail.myshopify.com", { enabled: true, expiryDays: 14, cadenceDays: [3], maxNudges: 1, expiryWarningDays: 3 });
    await rescheduleExpiryWarnings("mail.myshopify.com");
    const warning = await prisma.quoteFollowup.findFirstOrThrow({ where: { quoteId: quote.id, kind: "EXPIRY_WARNING" } });
    const run = new Date(Date.UTC(warning.scheduledFor.getUTCFullYear(), warning.scheduledFor.getUTCMonth(), warning.scheduledFor.getUTCDate() + 1, 10));
    while ([0, 6].includes(run.getUTCDay())) run.setUTCDate(run.getUTCDate() + 1);
    await dispatchForShop("mail.myshopify.com", BASE_URL, run);
    const reminders = outbox.filter((m) => m.to === "buyer@mail.example");
    expect(reminders.length).toBeGreaterThan(0);
    for (const m of reminders) expect(m.replyTo).toBe("owner@store.example");
  });

  it("tells the buyer when the order is placed", async () => {
    const { quote } = await seed();
    await emailQuoteOrdered(quote.id, BASE_URL);
    expect(outbox[0].subject).toBe("Your order with Mail Supply Co. is placed");
  });

  it("sends one expiry reminder at the chosen time, never two", async () => {
    const { quote } = await seed();
    await upsertPolicy("mail.myshopify.com", { enabled: true, expiryDays: 14, cadenceDays: [3], maxNudges: 1, expiryWarningDays: 3 });
    await rescheduleExpiryWarnings("mail.myshopify.com");
    const warning = await prisma.quoteFollowup.findFirstOrThrow({ where: { quoteId: quote.id, kind: "EXPIRY_WARNING" } });
    expect(Math.round((quote.expiresAt.getTime() - warning.scheduledFor.getTime()) / 86_400_000)).toBe(3);

    const at = new Date(warning.scheduledFor.getTime() + 60_000);
    // Business hours apply; use a weekday at 10:00 in the store's (UTC) zone.
    const run = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 10));
    while ([0, 6].includes(run.getUTCDay())) run.setUTCDate(run.getUTCDate() + 1);
    await dispatchForShop("mail.myshopify.com", BASE_URL, run);
    await dispatchForShop("mail.myshopify.com", BASE_URL, run);
    expect(outbox.filter((m) => m.tag === "followup_expiry_warning")).toHaveLength(1);

    // Changing the setting afterwards doesn't bring a second one.
    await upsertPolicy("mail.myshopify.com", { enabled: true, expiryDays: 14, cadenceDays: [3], maxNudges: 1, expiryWarningDays: 2 });
    await rescheduleExpiryWarnings("mail.myshopify.com", run);
    expect(await prisma.quoteFollowup.count({ where: { quoteId: quote.id, kind: "EXPIRY_WARNING", status: "SCHEDULED" } })).toBe(0);
  });

  it("customer redaction removes the emails sent to that customer", async () => {
    const { shop } = await seed();
    await sendEmail({ to: "buyer@mail.example", subject: "s", html: "h" }, { shopId: shop.id });
    await redactCustomer("mail.myshopify.com", { email: "BUYER@mail.example" });
    expect(await prisma.emailDelivery.count({ where: { shopId: shop.id } })).toBe(0);
  });
});
