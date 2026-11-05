/*
 * B — the buyer in the passwordless portal (magic link from M7), and
 * D — the public buyer demo. Each runs in a fresh private browser. Accepting a
 * quote and reordering create Shopify draft orders on the dev store (payment
 * pending, never charged); the report lists them.
 */
import { chromium } from "playwright";
import { pickNet30, sleep, textOf } from "../lib.mjs";

/** A plain-language problem the portal shows instead of the page (e.g. Shopify unreachable). */
async function portalProblem(p) {
  const t = await textOf(p);
  const m = t.match(/We couldn[’']t [^.]*\.|Something went wrong[^.]*\.|isn[’']t available[^.]*\./);
  return m ? m[0] : null;
}

async function acceptCountered(rec, p, idPrefix, ctx) {
  const row = p.locator("li.quote-list-row").filter({ has: p.locator(".status-countered") }).first();
  await rec.tc(`${idPrefix}3`, "Open the Countered quote, Net 30, Accept & create order", { action: "portal → first Countered quote → payment terms Net 30 → Accept & create order", expected: "a confirm panel appears; nothing written yet" }, async () => {
    if (!(await row.count())) {
      const pills = await p.locator(".status-pill").allTextContents();
      return { status: "BLOCKED", actual: `no Countered quote here (statuses: ${pills.join(", ") || "none"})` };
    }
    await row.getByRole("link").first().click();
    await p.getByRole("button", { name: /Accept & create order/ }).waitFor({ timeout: 20000 });
    ctx.portalQuoteUrl = p.url();
    const terms = await pickNet30(p);
    await p.getByRole("button", { name: /Accept & create order/ }).click();
    await p.getByRole("button", { name: /Confirm & create order/ }).waitFor({ timeout: 10000 });
    return { actual: `terms "${terms}"; confirm panel shown`, evidence: await rec.shot(p, `${idPrefix}-confirm`) };
  }, () => rec.shot(p, `${idPrefix}-accept-fail`));
  const ready = await p.getByRole("button", { name: /Confirm & create order/ }).count();
  await rec.tc(`${idPrefix}4`, "Confirm & create order", { action: "click Confirm & create order", expected: "status Ordered with Shopify's subtotal, tax and total" }, async () => {
    if (!ready) return { status: "BLOCKED", actual: "the confirm panel never opened" };
    const startedAt = new Date().toISOString();
    await p.getByRole("button", { name: /Confirm & create order/ }).click();
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      if (await p.locator(".status-ordered").count()) break;
      const alert = ((await p.locator("[role=alert]").allInnerTexts().catch(() => [])) || []).join(" ").trim();
      if (alert && /finished setting up your company account in Shopify/.test(alert)) {
        // The buyer isn't a company contact in Shopify: a store precondition, and the designed message.
        return { status: "BLOCKED", actual: `the portal says: "${alert.slice(0, 200)}" — the buyer isn't a company contact in Shopify (set MANNON_QA_EMAIL to a contact's email)`, evidence: await rec.shot(p, `${idPrefix}-not-a-contact`) };
      }
      if (alert) throw new Error(`the portal says: "${alert.slice(0, 200)}"`);
      await sleep(800);
    }
    if (!(await p.locator(".status-ordered").count())) throw new Error("no Ordered status within 45 s");
    const t = await textOf(p);
    const total = (t.match(/Total\s*\$?[\d,]+\.\d\d[^ ]*/) || [""])[0];
    ctx[`${idPrefix.toLowerCase()}4`] = { startedAt, total: Number(total.replace(/[^0-9.]/g, "")), via: `${idPrefix}4` };
    rec.created.push(`Shopify draft order from accepting ${ctx.portalQuoteUrl} (payment pending, Net 30)`);
    return { actual: `Ordered · ${total}`, evidence: await rec.shot(p, `${idPrefix}-ordered`) };
  }, () => rec.shot(p, `${idPrefix}-confirm-fail`));
}

export async function buyer(rec, ctx) {
  rec.begin("B · Buyer in the passwordless portal");
  if (!ctx.magicLink) {
    for (const [id, name] of [["B1", "Open the magic link"], ["B2", "Portal home"], ["B3", "Accept with Net 30"], ["B4", "Confirm & create order"], ["B5", "Order pad: paste SKUs"], ["B6", "Order pad: ✦ Read my order"], ["B7", "Request a quote page"], ["B8", "Invoices and Team"], ["B9", "Language switch"], ["B10", "Reorder"], ["B11", "Sign out"]]) {
      rec.blocked(id, name, { action: "—", expected: "—" }, "no magic link (M7 did not run or failed)");
    }
    return;
  }
  const browser = await chromium.launch({ headless: !ctx.headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  const base = new URL(ctx.magicLink).origin;
  const fail = (n) => () => rec.shot(p, n);
  try {
    await rec.tc("B1", "Open the magic link in a private window", { action: "open the link from M7; click Continue", expected: "'signing in as <email>', Continue, no password; then the portal" }, async () => {
      await p.goto(ctx.magicLink, { waitUntil: "domcontentloaded" });
      const t = await textOf(p);
      if (/password/i.test(t) && (await p.locator("input[type=password]").count())) throw new Error("a password field was shown");
      const who = (t.match(/signing in as ([^\s]+)/i) || [])[1];
      await p.getByRole("button", { name: "Continue" }).click();
      await p.waitForURL(/\/portal(\/?$|\?|\/)/, { timeout: 20000 });
      return { actual: `signing in as ${who || "?"} → ${p.url().replace(base, "")}`, evidence: await rec.shot(p, "portal-signin") };
    }, fail("b1-fail"));

    await rec.tc("B2", "Portal home", { action: "read the portal home", expected: "Welcome, Your quotes (and Reorder a past order when there is a recent order)" }, async () => {
      await p.goto(`${base}/portal`, { waitUntil: "networkidle" });
      const t = await textOf(p);
      if (!/Welcome/.test(t) || !/Your quotes/.test(t)) throw new Error("Welcome or Your quotes missing");
      return { actual: `quotes ${await p.locator("li.quote-list-row").count()}; reorder card ${/Reorder a past order/.test(t) ? "yes" : "no"}`, evidence: await rec.shot(p, "portal-home") };
    }, fail("b2-fail"));

    await acceptCountered(rec, p, "B", ctx);

    await rec.tc("B5", "Order pad: paste SKUs → Add pasted lines", { action: `order pad → Paste SKUs "${ctx.skus.replace(/\n/g, " / ")}" → Add pasted lines`, expected: "the lines appear under 'Your order'" }, async () => {
      await p.goto(`${base}/portal/quick-order`, { waitUntil: "networkidle" });
      const problem = await portalProblem(p);
      if (problem) return { status: "BLOCKED", actual: `the order pad says: "${problem}"`, evidence: await rec.shot(p, "order-pad-blocked") };
      const box = p.locator("textarea").first();
      await box.waitFor({ timeout: 10000 });
      await box.fill(ctx.skus);
      await p.getByRole("button", { name: "Add pasted lines" }).click();
      await sleep(1500);
      const t = await textOf(p);
      const m = t.match(/Your order \((\d+)/);
      if (!m || Number(m[1]) < 1) {
        const note = (t.match(/[^.]*(not found|unknown|no match)[^.]*\./i) || [""])[0];
        throw new Error(note || "no lines added (set MANNON_SKUS to real SKUs from the store)");
      }
      return { actual: `Your order (${m[1]} items)`, evidence: await rec.shot(p, "order-pad-skus") };
    }, fail("b5-fail"));

    if (ctx.ai) {
      await rec.tc("B6", "Order pad: paste a PO → ✦ Read my order", { action: "Paste a PO or email → Read my order", expected: "Claude's matches appear; nothing ordered until 'Request quote for these items'" }, async () => {
        const lines = ctx.skus.split("\n").map((l) => { const [s, q] = l.split(","); return `${(q || "1").trim()}x ${s.trim()}`; });
        // Locally the mock Claude answers a "made-up" line with an invented id: the server must drop it.
        if (ctx.localStack) lines.push("3x made-up widget");
        const po = `Hi, please send\n${lines.join("\n")}\nThanks`;
        if (!/\/portal\/quick-order/.test(p.url())) await p.goto(`${base}/portal/quick-order`, { waitUntil: "networkidle" });
        const problem = await portalProblem(p);
        if (problem) return { status: "BLOCKED", actual: `the order pad says: "${problem}"` };
        const ta = (await p.getByPlaceholder(/please send/i).count()) ? p.getByPlaceholder(/please send/i).first() : p.locator("textarea").last();
        await ta.fill(po);
        const start = new Date().toISOString();
        await p.getByRole("button", { name: "Read my order" }).click();
        await p.getByRole("button", { name: /Request quote for these items/ }).waitFor({ timeout: 60000 });
        await sleep(1000);
        ctx.b6 = { start, end: new Date().toISOString() };
        const ev = await rec.shot(p, "order-pad-ai");
        if (ctx.localStack) {
          const review = await textOf(p);
          const matched = (review.match(/sku-untracked-1|sku-managed-1|Untracked Sample|Managed Sample/gi) || []).length;
          if (!/made-up widget/i.test(review)) throw new Error("the invented line is not shown as unmatched");
          if (/MADE-UP|ProductVariant\/999999/.test(review)) throw new Error("the invented id is offered as a match");
          return { actual: `matches shown (${matched} mentions); the made-up line is listed as not matched; nothing ordered`, evidence: ev };
        }
        return { actual: "Claude matched the lines; nothing ordered", evidence: ev };
      }, fail("b6-fail"));
    } else rec.skip("B6", "Order pad: ✦ Read my order", { action: "—", expected: "—" }, "--no-ai");

    await rec.tc("B7", "Request a quote page", { action: "open /portal/quotes/new", expected: "'Request a quote' with the catalog" }, async () => {
      await p.goto(`${base}/portal/quotes/new`, { waitUntil: "networkidle" });
      if (!/Request a quote/.test(await textOf(p))) throw new Error("heading missing");
      return { actual: "renders", evidence: await rec.shot(p, "portal-new-quote") };
    }, fail("b7-fail"));

    for (const [path, word, id] of [["/portal/invoices", "Invoices", "B8a"], ["/portal/team", "Team", "B8b"]]) {
      await rec.tc(id, `${word} page`, { action: `open ${path}`, expected: `'${word}' renders (SKIP when the feature is off)` }, async () => {
        const r = await p.goto(base + path, { waitUntil: "networkidle" });
        if (r && r.status() === 404) return { status: "SKIP", actual: "404: feature off" };
        const t = await textOf(p);
        if (/Something went wrong/.test(t)) throw new Error("error page");
        if (!new RegExp(word).test(t)) throw new Error(`'${word}' not on the page`);
        return { actual: "renders" };
      }, fail(`${id}-fail`));
    }

    await rec.tc("B9", "Language: العربية, then English", { action: "portal home → العربية → English", expected: "right-to-left in Arabic, left-to-right again in English" }, async () => {
      await p.goto(`${base}/portal`, { waitUntil: "networkidle" });
      const ar = p.getByRole("button", { name: "العربية" }).first();
      if (!(await ar.count())) return { status: "SKIP", actual: "no language switch (i18n off)" };
      await ar.click();
      await p.waitForLoadState("networkidle");
      await sleep(800);
      const rtl = await p.locator("[dir=rtl]").count();
      const ev = await rec.shot(p, "portal-arabic");
      await p.getByRole("button", { name: "English" }).first().click();
      await p.waitForLoadState("networkidle");
      await sleep(800);
      const back = await p.locator("[dir=rtl]").count();
      if (!rtl) throw new Error("no right-to-left layout after choosing العربية");
      if (back) throw new Error("still right-to-left after choosing English");
      return { actual: "rtl in Arabic, ltr in English", evidence: ev };
    }, fail("b9-fail"));

    await rec.tc("B10", "Reorder a past order", { action: "portal home → Reorder on the first card → Send reorder", expected: "a draft order, or a quote awaiting approval" }, async () => {
      await p.goto(`${base}/portal`, { waitUntil: "networkidle" });
      const link = p.getByRole("link", { name: "Reorder", exact: true }).first();
      if (!(await link.count())) return { status: "INFO", actual: "no reorder card (no order for this buyer in the last 60 days)" };
      await link.click();
      const send = p.getByRole("button", { name: "Send reorder" });
      await send.or(p.getByText(/We couldn[’']t /)).first().waitFor({ timeout: 20000 });
      const problem = await portalProblem(p);
      if (problem && !(await send.count())) return { status: "BLOCKED", actual: `the reorder page says: "${problem}"`, evidence: await rec.shot(p, "reorder-blocked") };
      const startedAt = new Date().toISOString();
      await send.click();
      await p.waitForURL(/\/portal\/quotes\//, { timeout: 30000 });
      const t = await textOf(p);
      const outcome = /Ordered/.test(t) ? "Ordered (draft order created)" : /approv/i.test(t) ? "awaiting the merchant's approval" : "a new quote";
      ctx.b10 = { startedAt, outcome, ordered: /Ordered/.test(t) };
      rec.created.push(`Reorder from the buyer portal: ${outcome}`);
      return { actual: outcome, evidence: await rec.shot(p, "portal-reorder") };
    }, fail("b10-fail"));

    await rec.tc("B11", "Sign out", { action: "Sign out, then open /portal again", expected: "the sign-in page; the old session no longer opens the portal" }, async () => {
      await p.goto(`${base}/portal`, { waitUntil: "networkidle" });
      const so = p.getByRole("button", { name: "Sign out" }).or(p.getByRole("link", { name: "Sign out" })).first();
      if (!(await so.count())) throw new Error("no Sign out control");
      await so.click();
      await p.waitForURL(/\/portal\/signin/, { timeout: 15000 });
      await p.goto(`${base}/portal`, { waitUntil: "networkidle" });
      const t = await textOf(p);
      if (/Your quotes/.test(t) && /Welcome/.test(t)) throw new Error("the portal still opens after signing out");
      return { actual: `after sign-out /portal shows: "${t.slice(0, 80)}"` };
    }, fail("b11-fail"));
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function demo(rec, ctx) {
  rec.begin("D · Public buyer demo");
  const browser = await chromium.launch({ headless: !ctx.headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await context.newPage();
  try {
    let landed = false;
    await rec.tc("D1", "Demo hub → Open the buyer demo", { action: `${ctx.live}/demo → Open the buyer demo`, expected: "lands in the portal as Demo buyer, with a Countered quote and a reorder card" }, async () => {
      await p.goto(`${ctx.live}/demo`, { waitUntil: "networkidle" });
      const open = p.getByRole("link", { name: "Open the buyer demo" }).first();
      if (!(await open.count())) return { status: "BLOCKED", actual: "Buyer demo unavailable (no demo store configured)" };
      await open.click();
      await p.waitForLoadState("networkidle");
      const t = await textOf(p);
      if (/Too many demo sessions/i.test(t)) return { status: "BLOCKED", actual: "rate limited: 5 demo starts per hour from your network" };
      if (!/\/portal/.test(p.url())) throw new Error(`stayed on ${p.url()}: ${t.slice(0, 100)}`);
      landed = true;
      return { actual: `countered quotes ${await p.locator(".status-countered").count()}; reorder card ${/Reorder a past order/.test(t) ? "yes" : "no"}`, evidence: await rec.shot(p, "demo-portal") };
    }, () => rec.shot(p, "d1-fail"));
    if (landed) {
      await acceptCountered(rec, p, "D", ctx);
      await rec.tc("D5", "Demo: Reorder a past order", { action: "portal home → Reorder → Send reorder", expected: "a new quote marked Ordered, or an approval note" }, async () => {
        await p.goto(new URL("/portal", p.url()).toString(), { waitUntil: "networkidle" });
        const link = p.getByRole("link", { name: "Reorder", exact: true }).first();
        if (!(await link.count())) return { status: "INFO", actual: "no reorder card on the demo store" };
        await link.click();
        const send = p.getByRole("button", { name: "Send reorder" });
        await send.or(p.getByText(/We couldn[’']t /)).first().waitFor({ timeout: 20000 });
        const problem = await portalProblem(p);
        if (problem && !(await send.count())) return { status: "BLOCKED", actual: `the reorder page says: "${problem}"` };
        const startedAt = new Date().toISOString();
        await send.click();
        await p.waitForURL(/\/portal\/quotes\//, { timeout: 30000 });
        const t = await textOf(p);
        ctx.d5 = { startedAt, outcome: /Ordered/.test(t) ? "Ordered" : "awaiting approval or a new quote", ordered: /Ordered/.test(t) };
        rec.created.push("Demo reorder on the demo store");
        return { actual: /Ordered/.test(t) ? "Ordered" : /approv/i.test(t) ? "awaiting approval" : "new quote", evidence: await rec.shot(p, "demo-reorder") };
      }, () => rec.shot(p, "d5-fail"));
    }
  } finally {
    await context.close();
    await browser.close();
  }
}
