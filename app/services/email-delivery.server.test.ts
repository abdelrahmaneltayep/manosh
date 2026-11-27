import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import prisma from "../db.server";
import { emailDeliveryEnabled, sendEmail, setMailTransport, type EmailMessage } from "./mailer.server";
import { safePortalPath, verifyMagicToken } from "./magic-link.server";
import { issueBuyerQuoteLink } from "./buyer-sign-in-link.server";
import { copyReminder, dispatchForShop, sendNow } from "./followups.server";
import { decideApplication } from "./wholesale.server";
import { prepareRequestReply, replyToRequest } from "./quote-widget.server";

// Mannon has no email provider connected. These tests pin the honest behaviour:
// nothing is reported or recorded as sent unless a provider accepted it, and
// the merchant gets the link or text to send themselves instead.

const hasDb = Boolean(process.env.DATABASE_URL);
const BASE_URL = "https://app.example.com";
const MESSAGE: EmailMessage = { to: "buyer@example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };
const savedFrom = process.env.MANNON_MAIL_FROM;

function restoreEnv() {
  setMailTransport(null);
  if (savedFrom === undefined) delete process.env.MANNON_MAIL_FROM;
  else process.env.MANNON_MAIL_FROM = savedFrom;
}

describe("email delivery switch", () => {
  afterEach(restoreEnv);

  it("is off with no provider, even when a sender address is set", async () => {
    process.env.MANNON_MAIL_FROM = "orders@example.com";
    expect(emailDeliveryEnabled()).toBe(false);
    expect(await sendEmail(MESSAGE)).toEqual({ sent: false, skipped: "unconfigured" });
  });

  it("is off with a provider but no sender address", () => {
    delete process.env.MANNON_MAIL_FROM;
    setMailTransport(async () => undefined);
    expect(emailDeliveryEnabled()).toBe(false);
  });

  it("is on with both, and reports sent only when the provider accepts", async () => {
    process.env.MANNON_MAIL_FROM = "orders@example.com";
    const delivered: Array<{ to: string; from: string }> = [];
    setMailTransport(async (message, from) => {
      delivered.push({ to: message.to, from });
    });
    expect(emailDeliveryEnabled()).toBe(true);
    expect(await sendEmail(MESSAGE)).toEqual({ sent: true });
    expect(delivered).toEqual([{ to: "buyer@example.com", from: "orders@example.com" }]);
  });

  it("reports not sent when the provider fails, and never throws", async () => {
    process.env.MANNON_MAIL_FROM = "orders@example.com";
    setMailTransport(async () => {
      throw new Error("provider down");
    });
    expect(await sendEmail(MESSAGE)).toEqual({ sent: false });
  });
});

describe("safePortalPath", () => {
  it("keeps paths inside the buyer portal", () => {
    expect(safePortalPath("/portal")).toBe("/portal");
    expect(safePortalPath("/portal/quotes/ckx123_ab-9")).toBe("/portal/quotes/ckx123_ab-9");
  });

  it("drops anything that could leave the portal", () => {
    for (const bad of [
      "", null, undefined, "https://evil.example/portal", "//evil.example", "/portal/../app", "/app/quotes",
      "/portal?next=https://evil.example", "/portal/quotes/1#x", "/portalx", "/portal//evil.example", "javascript:alert(1)",
      "/portal/quotes/a b",
    ]) {
      expect(safePortalPath(bad as string | null), String(bad)).toBeNull();
    }
  });
});

async function seed() {
  // Starter: room for the extra company an approval adds (Free allows one).
  const shop = await prisma.shop.create({ data: { shopifyDomain: "honest.myshopify.com", magicLinkExpiryDays: 7, plan: "STARTER" } });
  const company = await prisma.company.create({
    data: { shopId: shop.id, shopifyCompanyId: "gid://shopify/Company/honest", name: "Honest Co." },
  });
  const buyer = await prisma.buyer.create({ data: { companyId: company.id, email: "buyer@honest.example", name: "Sam" } });
  const quote = await prisma.quote.create({
    data: { companyId: company.id, buyerId: buyer.id, status: "COUNTERED", expiresAt: new Date("2030-01-10T10:00:00Z") },
  });
  const followup = await prisma.quoteFollowup.create({
    data: { quoteId: quote.id, kind: "REMINDER", scheduledFor: new Date("2020-01-01T10:00:00Z") },
  });
  return { shop, company, buyer, quote, followup };
}

describe.skipIf(!hasDb)("with no provider connected", () => {
  beforeEach(async () => {
    restoreEnv();
    process.env.MANNON_MAIL_FROM = "orders@example.com"; // an address alone must not turn delivery on
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Buyer","Company","Shop" RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    restoreEnv();
    await prisma.$disconnect();
  });

  it("makes a buyer link that signs in and opens the quote, for this shop only", async () => {
    const { quote, buyer } = await seed();

    expect(await issueBuyerQuoteLink("someone-else.myshopify.com", quote.id, BASE_URL)).toBeNull();

    const link = await issueBuyerQuoteLink("honest.myshopify.com", quote.id, BASE_URL);
    expect(link?.buyerEmail).toBe("buyer@honest.example");
    const url = new URL(link!.url);
    expect(url.pathname).toBe("/portal/auth");
    expect(url.searchParams.get("next")).toBe(`/portal/quotes/${quote.id}`);

    // The raw token is only in the URL; the database holds its hash.
    const stored = await prisma.buyer.findUniqueOrThrow({ where: { id: buyer.id } });
    expect(stored.magicTokenHash).not.toBe(url.searchParams.get("token"));
    const verified = await verifyMagicToken(url.searchParams.get("token"), { consume: false });
    expect(verified.ok).toBe(true);
  });

  it("sendNow records nothing when the reminder can't be delivered", async () => {
    const { shop, quote, followup } = await seed();

    expect(await sendNow(shop.shopifyDomain, quote.id, BASE_URL)).toBe(false);

    expect((await prisma.quoteFollowup.findUniqueOrThrow({ where: { id: followup.id } })).status).toBe("SCHEDULED");
    expect(await prisma.event.count({ where: { shopId: shop.id, type: "FOLLOWUP_SENT" } })).toBe(0);
  });

  it("the automatic run leaves due reminders waiting instead of marking them sent", async () => {
    const { shop, followup } = await seed();

    const result = await dispatchForShop(shop.shopifyDomain, BASE_URL, new Date("2026-11-25T10:00:00Z"));

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect((await prisma.quoteFollowup.findUniqueOrThrow({ where: { id: followup.id } })).status).toBe("SCHEDULED");
    expect(await prisma.event.count({ where: { shopId: shop.id, type: "FOLLOWUP_SENT" } })).toBe(0);
  });

  it("copyReminder hands over the text with a working sign-in link and advances the cadence", async () => {
    const { shop, quote, followup } = await seed();

    const reminder = await copyReminder(shop.shopifyDomain, quote.id, BASE_URL, { customBody: "Any questions on the pricing?" });

    expect(reminder?.to).toBe("buyer@honest.example");
    expect(reminder?.body).toContain("Any questions on the pricing?");
    // A personal message carries no automatic-reminder unsubscribe line.
    expect(reminder?.body).not.toContain("/portal/unsubscribe/");
    const link = reminder!.body.match(/https:\/\/app\.example\.com\/portal\/auth\?\S+/)?.[0];
    expect(link).toBeTruthy();
    const url = new URL(link!);
    expect(url.searchParams.get("next")).toBe(`/portal/quotes/${quote.id}`);
    expect((await verifyMagicToken(url.searchParams.get("token"), { consume: false })).ok).toBe(true);

    expect((await prisma.quoteFollowup.findUniqueOrThrow({ where: { id: followup.id } })).status).toBe("SENT");
    const events = await prisma.event.findMany({ where: { shopId: shop.id, type: "FOLLOWUP_SENT" } });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ manual: true, via: "copy" });
  });

  it("copyReminder refuses a quote from another shop or a closed quote", async () => {
    const { shop, quote } = await seed();
    expect(await copyReminder("someone-else.myshopify.com", quote.id, BASE_URL)).toBeNull();
    await prisma.quote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
    expect(await copyReminder(shop.shopifyDomain, quote.id, BASE_URL)).toBeNull();
  });

  it("a wholesale decision returns the message for the merchant to send", async () => {
    const { shop } = await seed();
    const application = await prisma.wholesaleApplication.create({
      data: { shopId: shop.id, companyName: "New Trade", contactEmail: "apply@trade.example", answers: {}, status: "PENDING", tags: [] },
    });

    const message = await decideApplication(shop.shopifyDomain, application.id, "APPROVED", "tester", BASE_URL, {
      customNote: "Welcome aboard.",
    });

    expect(message.sent).toBe(false);
    expect(message.to).toBe("apply@trade.example");
    expect(message.body).toContain("Welcome aboard.");
    // Approved applicants get their sign-in link inside the message.
    expect(message.body).toMatch(/https:\/\/app\.example\.com\/portal\/auth\?token=/);
    expect((await prisma.wholesaleApplication.findUniqueOrThrow({ where: { id: application.id } })).status).toBe("APPROVED");
  });

  it("a storefront request reply is prepared, not reported as sent", async () => {
    const { shop } = await seed();
    const request = await prisma.quoteRequest.create({
      data: { shopId: shop.id, email: "visitor@shopper.example", lines: [] },
    });

    expect(await replyToRequest(shop.shopifyDomain, request.id, "We can do 500 units.")).toBe(false);
    expect(await prepareRequestReply(shop.shopifyDomain, request.id, "  We can do 500 units.  ")).toEqual({
      to: "visitor@shopper.example",
      text: "We can do 500 units.",
    });
    expect(await prepareRequestReply("someone-else.myshopify.com", request.id, "Hi")).toBeNull();
    expect(await prepareRequestReply(shop.shopifyDomain, request.id, "   ")).toBeNull();
  });
});

describe.skipIf(!hasDb)("with a provider connected", () => {
  beforeEach(async () => {
    restoreEnv();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Buyer","Company","Shop" RESTART IDENTITY CASCADE');
  });
  afterEach(restoreEnv);

  it("sendNow delivers, advances the cadence and records the send", async () => {
    const { shop, quote, followup } = await seed();
    process.env.MANNON_MAIL_FROM = "orders@example.com";
    const delivered: EmailMessage[] = [];
    setMailTransport(async (message) => {
      delivered.push(message);
    });

    expect(await sendNow(shop.shopifyDomain, quote.id, BASE_URL)).toBe(true);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].to).toBe("buyer@honest.example");
    expect((await prisma.quoteFollowup.findUniqueOrThrow({ where: { id: followup.id } })).status).toBe("SENT");
    const events = await prisma.event.findMany({ where: { shopId: shop.id, type: "FOLLOWUP_SENT" } });
    expect(events[0].payload).toMatchObject({ manual: true, via: "email" });
  });
});
