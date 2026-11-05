/*
 * A — the Shopify side of every flow. What Mannon asked Shopify to do, and
 * whether Shopify's own admin shows it.
 *
 * Live (your signed-in Chrome): Shopify Admin's own pages — Apps, the Mannon
 * entry in the admin navigation, Draft orders (B4/B10/D4 land here), Companies
 * (native B2B), Customers (this run's storefront email), Billing (the app
 * subscription), Payment terms. Read-only: nothing is clicked except links.
 *
 * Local (--local): the mock Admin API's call log. Checks the guardrails at the
 * API boundary: totals come from Shopify, drafts carry the company, terms and
 * agreed prices, no id Claude invented reaches Shopify, Claude runs at
 * temperature 0, and reading an order with Claude writes nothing.
 */
import { MOCK_CATALOG } from "../local/mock-shopify.mjs";
import { sleep, textOf } from "../lib.mjs";

const amount = (s) => Number(String(s || "").replace(/[^0-9.]/g, ""));

function localChecks(rec, ctx) {
  const { shopify, claude } = ctx.localStack;
  const calls = shopify.calls;
  const drafts = [...shopify.drafts.values()];
  const known = new Set(MOCK_CATALOG.flatMap((p) => p.variants.map((v) => v.id)));

  const unknown = [...new Set(calls.filter((c) => !c.known).map((c) => c.op))];
  rec.add({ id: "A1", name: "Every Admin API call is one the mock answers", action: "read the mock Admin API log", expected: "no unanswered operations (a gap would hide a failure)", status: unknown.length ? "INFO" : "PASS", actual: `${calls.length} calls: ${[...new Set(calls.map((c) => c.op))].join(", ")}${unknown.length ? ` · unanswered: ${unknown.join(", ")}` : ""}` });

  const acc = ctx.b4 || ctx.d4;
  const b4 = acc && drafts.filter((d) => d.createdAt >= acc.startedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!acc) rec.blocked("A2", "Accepted quote: the total shown is Shopify's", { action: "compare B4's total with the draft order Shopify returned", expected: "equal" }, "neither B4 nor D4 created an order");
  else if (!b4) rec.add({ id: "A2", name: "Accepted quote: the total shown is Shopify's", action: "find the draft order B4 created", expected: `one draftOrderCreate after ${acc?.via} started`, status: "FAIL", actual: "no draft order was created" });
  else {
    const shopifyTotal = amount(b4.totalPriceSet.shopMoney.amount);
    rec.add({ id: "A2", name: "Accepted quote: the total shown is Shopify's", action: "compare the portal's Ordered total with the draft order's totalPriceSet", expected: "equal (draftOrderCalculate/Create is the only source of money)", status: Math.abs(shopifyTotal - acc.total) < 0.005 ? "PASS" : "FAIL", actual: `${acc.via}: portal ${acc.total.toFixed(2)} · Shopify ${shopifyTotal.toFixed(2)} (${b4.id})` });

    const inp = b4.input || {};
    const pc = inp.purchasingEntity?.purchasingCompany || {};
    const problems = [];
    if (!pc.companyId || !pc.companyLocationId || !pc.companyContactId) problems.push("purchasing company, location or contact missing");
    if (!(inp.lineItems || []).length || inp.lineItems.some((l) => !l.priceOverride?.amount)) problems.push("a line has no agreed price (priceOverride)");
    if (!/PaymentTermsTemplate\/4$/.test(inp.paymentTerms?.paymentTermsTemplateId || "")) problems.push(`payment terms ${inp.paymentTerms?.paymentTermsTemplateId || "none"} (expected Net 30)`);
    else if (!inp.paymentTerms.paymentSchedules?.[0]?.issuedAt) problems.push("Net terms without an issuedAt schedule");
    rec.add({ id: "A3", name: "Accepted quote: the draft order carries company, Net 30 and the agreed prices", action: "read the draftOrderCreate input", expected: "purchasingCompany (company, location, contact), priceOverride on every line, Net 30 with issuedAt", status: problems.length ? "FAIL" : "PASS", actual: problems.join("; ") || `${inp.lineItems.length} line(s) at agreed prices · ${pc.companyId} · Net 30 issued ${inp.paymentTerms.paymentSchedules[0].issuedAt.slice(0, 10)}${inp.poNumber ? ` · PO ${inp.poNumber}` : ""}` });
  }

  const sent = calls.filter((c) => /DraftOrder(Create|Calculate)$/.test(c.op)).flatMap((c) => (c.variables?.input?.lineItems || []).map((l) => l.variantId));
  const invented = sent.filter((id) => !known.has(id));
  rec.add({ id: "A4", name: "No invented id reaches Shopify", action: "every variantId sent to draftOrderCalculate/Create", expected: "all from the live catalog (B6 fed Claude a 'made-up' line)", status: invented.length ? "FAIL" : "PASS", actual: invented.length ? `sent unknown ids: ${[...new Set(invented)].join(", ")}` : `${sent.length} line ids sent, all in the catalog` });

  const cc = claude.calls;
  const hot = cc.filter((c) => c.temperature !== 0);
  rec.add({ id: "A5", name: "Claude runs at temperature 0 with a forced tool", action: "read the mock Claude log", expected: "temperature 0 on every call", status: !cc.length ? "INFO" : hot.length ? "FAIL" : "PASS", actual: cc.length ? `${cc.length} call(s): ${[...new Set(cc.map((c) => `${c.tool || "text"} (${c.model})`))].join(", ")}${hot.length ? ` · not 0: ${hot.map((c) => `${c.tool}=${c.temperature}`).join(", ")}` : ""}` : "no Claude call this run" });

  if (ctx.b6) {
    const writes = calls.filter((c) => c.at >= ctx.b6.start && c.at <= ctx.b6.end && /DraftOrderCreate|DraftOrderComplete|InvoiceSend/.test(c.op));
    rec.add({ id: "A6", name: "✦ Read my order writes nothing to Shopify", action: "Admin API writes while B6 ran", expected: "none (the buyer confirms first)", status: writes.length ? "FAIL" : "PASS", actual: writes.length ? writes.map((c) => c.op).join(", ") : "no draft order, no completion, no invoice" });
  } else rec.skip("A6", "✦ Read my order writes nothing", { action: "—", expected: "—" }, "B6 did not run");

  const ro = ctx.b10 || ctx.d5;
  const reorder = ro && drafts.find((d) => d.createdAt >= ro.startedAt && d !== b4);
  const roOk = !ro ? null : ro.ordered ? !!reorder : true;
  rec.add({ id: "A7", name: "Reorder: Shopify draft order or approval", action: "draft orders created after the reorder (B10, else D5)", expected: "a draft with the past order's lines when the portal says Ordered; none when it waits for approval", status: !ro ? "INFO" : roOk ? "PASS" : "FAIL", actual: !ro ? "no reorder ran" : reorder ? `${reorder.id} · ${reorder.input.lineItems.map((l) => `${l.quantity}× ${l.variantId.split("/").pop()}`).join(", ")} · total ${reorder.totalPriceSet.shopMoney.amount}` : `no draft: ${ro.outcome}` });
}

async function admin(page, ctx, path) {
  const handle = ctx.store.replace(/\.myshopify\.com$/, "");
  await page.goto(`https://admin.shopify.com/store/${handle}${path}`, { waitUntil: "domcontentloaded" });
  if (/accounts\.shopify\.com|\/login/.test(page.url())) {
    console.log("Sign in to Shopify in the Chrome window; waiting up to 5 minutes…");
    await page.waitForURL(/admin\.shopify\.com\/store\//, { timeout: 300000 });
    await page.goto(`https://admin.shopify.com/store/${handle}${path}`, { waitUntil: "domcontentloaded" });
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  return textOf(page);
}

async function liveChecks(rec, ctx) {
  const browser = ctx.adminBrowser;
  if (!browser) {
    for (const [id, name] of [["A1", "Apps: Mannon installed"], ["A2", "Admin navigation: Mannon"], ["A3", "Draft orders"], ["A4", "Companies (native B2B)"], ["A5", "Customers: this run's email"], ["A6", "Billing: app subscription"], ["A7", "Payment terms"]]) rec.blocked(id, name, { action: "Shopify Admin in your Chrome", expected: "—" }, "no signed-in Chrome (see M0)");
    return;
  }
  const page = await (browser.contexts()[0] || (await browser.newContext())).newPage();
  const fail = () => rec.shot(page, "shopify-admin-fail");
  try {
    await rec.tc("A1", "Apps: Mannon is installed", { action: "Settings → Apps", expected: "Mannon listed among installed apps" }, async () => {
      const t = await admin(page, ctx, "/settings/apps");
      if (!/Mannon/i.test(t)) throw new Error("Mannon is not in the installed apps list");
      return { actual: "Mannon listed", evidence: await rec.shot(page, "shopify-apps") };
    }, fail);

    await rec.tc("A2", "Admin navigation: Mannon opens from the sidebar", { action: "Shopify Admin home → sidebar Apps → Mannon", expected: "a Mannon link in the admin navigation" }, async () => {
      await admin(page, ctx, "");
      const link = page.getByRole("link", { name: /^Mannon$/ }).first();
      if (!(await link.count())) return { status: "INFO", actual: "no pinned Mannon link in the sidebar (pin it under Apps)" };
      return { actual: `sidebar link → ${await link.getAttribute("href")}` };
    }, fail);

    await rec.tc("A3", "Draft orders: this run's orders are in Shopify", { action: "Orders → Drafts", expected: "the draft orders from B4, B10 and D4 (created just now), payment pending" }, async () => {
      const t = await admin(page, ctx, "/draft_orders");
      if (/There['’]s no page at this address/i.test(t)) throw new Error("no Draft orders page (read_draft_orders?)");
      const recent = (t.match(/Just now|\d+ minutes? ago|Today at/gi) || []).length;
      const expected = [ctx.b4, ctx.b10?.ordered, ctx.d4, ctx.d5?.ordered].filter(Boolean).length;
      const status = expected === 0 ? "INFO" : recent >= 1 ? "PASS" : "FAIL";
      return { status, actual: `${recent} draft(s) created today${expected ? ` (this run created ${expected})` : ""}`, evidence: await rec.shot(page, "shopify-draft-orders") };
    }, fail);

    await rec.tc("A4", "Companies: native B2B companies", { action: "Customers → Companies", expected: "the page lists companies (Mannon rides Shopify's companies, never its own)" }, async () => {
      const t = await admin(page, ctx, "/companies");
      if (/There['’]s no page at this address|isn['’]t available on your plan/i.test(t)) return { status: "INFO", actual: "Companies is not available on this store's plan" };
      return { actual: /No companies|Add a company/i.test(t) && !/Acme|QA/.test(t) ? "no companies yet" : "companies listed", evidence: await rec.shot(page, "shopify-companies") };
    }, fail);

    await rec.tc("A5", "Customers: is this run's shopper a Shopify customer?", { action: `Customers → search ${ctx.email || "(no email)"}`, expected: "INFO: a customer (and, for M3–B4, a company contact) or none" }, async () => {
      if (!ctx.email) return { status: "SKIP", actual: "the storefront step sent no request" };
      const t = await admin(page, ctx, `/customers?query=${encodeURIComponent(ctx.email)}`);
      // The search box and "No customers found matching …" both echo the email,
      // so count result links instead of looking for the text.
      const rows = await page.locator('a[href*="/customers/"]').filter({ hasNotText: /^Customers$/ }).count();
      const none = /No customers found|couldn[’']t find any customers|No results/i.test(t) || rows === 0;
      return { status: "INFO", actual: none ? `no customer has ${ctx.email}: add them as a contact at a company (Customers → Companies) or run with MANNON_QA_EMAIL set to a contact's email` : `a customer has ${ctx.email}` };
    }, fail);

    await rec.tc("A6", "Billing: the Mannon subscription", { action: "Settings → Billing → Subscriptions", expected: "INFO: Mannon's plan as Shopify bills it (none on Free)" }, async () => {
      const t = await admin(page, ctx, "/settings/billing/subscriptions");
      const line = (t.match(/Mannon[^.]{0,80}/i) || [""])[0];
      return { status: "INFO", actual: line || "no Mannon subscription listed (Free plan or trial not started)", evidence: await rec.shot(page, "shopify-billing") };
    }, fail);

    await rec.tc("A7", "Payment terms: Net 30 exists", { action: "Settings → Payments → Payment terms", expected: "Net 30 available (B3 picks it)" }, async () => {
      const t = await admin(page, ctx, "/settings/payments");
      return { status: /Net\s*30|payment terms/i.test(t) ? "PASS" : "INFO", actual: /Net\s*30/i.test(t) ? "Net 30 listed" : "payment terms section not found on the page" };
    }, fail);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function shopifyAdmin(rec, ctx) {
  rec.begin(ctx.localStack ? "A · Shopify side (mock Admin API log)" : "A · Shopify Admin (native pages)");
  if (ctx.localStack) localChecks(rec, ctx);
  else await liveChecks(rec, ctx);
}
