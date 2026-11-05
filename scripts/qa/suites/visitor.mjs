/*
 * V — the visitor on the public site (home, pricing, demo store, demo hub,
 * merchant tour), in a fresh browser at desktop and phone width. Read-only:
 * the demo store page is a mock and never calls Shopify.
 */
import { chromium } from "playwright";

export async function visitor(rec, ctx) {
  rec.begin("V · Visitor on the public site");
  const L = ctx.live;
  const browser = await chromium.launch({ headless: !ctx.headed });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const fail = () => rec.shot(page, "visitor-fail");

  try {
    await rec.tc("V1", "Home: headline and nav", { action: `open ${L}/`, expected: "H1 'From a buyer’s first click…'; nav Demo store, The journey, Features, Pricing; no 'All options'" }, async () => {
      await page.goto(`${L}/`, { waitUntil: "networkidle" });
      const h1 = (await page.locator("h1").first().innerText()).replace(/\s+/g, " ");
      if (!/From a buyer.s first click/.test(h1)) throw new Error(`H1 is "${h1}"`);
      const nav = page.getByRole("navigation", { name: "Main" });
      const links = (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim());
      for (const want of ["Demo store", "The journey", "Features", "Pricing"]) if (!links.includes(want)) throw new Error(`nav lacks ${want} (${links.join(", ")})`);
      if (await page.getByText("All options").count()) throw new Error("'All options' is on the page");
      return { actual: `H1 "${h1}" · nav ${links.join(", ")}`, evidence: await rec.shot(page, "home") };
    }, fail);

    await rec.tc("V2", "Home: eight journey steps and the step bar", { action: "count the step bar links; click step 6", expected: "8 steps; step 6 scrolls into view and its pill is highlighted" }, async () => {
      const pills = page.getByRole("navigation", { name: "Journey steps" }).getByRole("link");
      const n = await pills.count();
      if (n !== 8) throw new Error(`${n} step links`);
      await pills.nth(5).click();
      await page.waitForTimeout(1200);
      const inView = await page.evaluate(() => { const r = document.getElementById("s6").getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
      const on = await pills.nth(5).getAttribute("class");
      if (!inView) throw new Error("step 6 is not in view after clicking its pill");
      return { actual: `8 steps; step 6 in view; pill class "${on}"`, evidence: await rec.shot(page, "home-step-6") };
    }, fail);

    await rec.tc("V3", "Home: demo store section, features, how to install (2.3.1)", { action: "look for the section headings, the App Store link and any shop-domain field", expected: "'Shop it like a wholesale buyer', the features heading, 'Install from the Shopify App Store'; no field asking for a myshopify.com domain" }, async () => {
      for (const h of ["Shop it like a wholesale buyer", "Everything you need to quote, from storefront to draft order"]) {
        if (!(await page.getByRole("heading", { name: h }).count())) throw new Error(`missing heading "${h}"`);
      }
      const shopField = await page.locator('input[name="shop"]').count();
      if (shopField) throw new Error("the page asks for a shop domain (App Store 2.3.1)");
      const store = await page.getByRole("link", { name: "Install from the Shopify App Store" }).getAttribute("href");
      return { actual: `both sections; App Store link ${store}; no shop-domain field` };
    }, fail);

    await rec.tc("V4", "Home → Open the demo store", { action: "click 'Open the demo store'", expected: "lands on /demo/store" }, async () => {
      await page.getByRole("link", { name: "Open the demo store" }).first().click();
      await page.waitForURL(/\/demo\/store/, { timeout: 15000 });
      return { actual: page.url() };
    }, fail);

    await rec.tc("V8", "Demo store: Add to Quote → three steps → sent", { action: "Add to Quote, Next step, Next step, Send quote request", expected: "'Quote request sent'" }, async () => {
      await page.getByRole("button", { name: "Add to Quote" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Request a quote" });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Next step" }).click();
      await dialog.getByLabel("Work email").waitFor();
      await dialog.getByRole("button", { name: "Next step" }).click();
      await dialog.getByRole("button", { name: "Send quote request" }).click();
      await dialog.getByRole("heading", { name: "Quote request sent" }).waitFor();
      const ev = await rec.shot(page, "demo-store-sent");
      await page.keyboard.press("Escape");
      return { actual: "the three steps completed; confirmation shown", evidence: ev };
    }, fail);

    await rec.tc("V9", "Demo store: guest price gate and the way back", { action: "click 'guest (price gate on)', then check 'Back to Mannon'", expected: "the price is replaced by 'Log in for wholesale pricing'; the back link goes to /" }, async () => {
      await page.getByRole("button", { name: "guest (price gate on)" }).click();
      await page.getByText(/Log in for wholesale pricing/).first().waitFor();
      const href = await page.getByRole("link", { name: /Back to Mannon/ }).first().getAttribute("href");
      if (href !== "/") throw new Error(`back link is ${href}`);
      return { actual: "gate shown; back link /", evidence: await rec.shot(page, "demo-store-gate") };
    }, fail);

    await rec.tc("V5", "Pricing opens at the top", { action: "home → nav Pricing", expected: "lands on /pricing, scrolled to the top" }, async () => {
      await page.goto(`${L}/`, { waitUntil: "networkidle" });
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(500);
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pricing" }).click();
      await page.waitForURL(/\/pricing/);
      await page.waitForTimeout(800);
      const y = await page.evaluate(() => window.scrollY);
      return { status: y < 50 ? "PASS" : "FAIL", actual: `scrollY ${y}` };
    }, fail);

    await rec.tc("V6", "Pricing: monthly and annual", { action: "read Growth, flip the annual switch", expected: "$29/month; annual $24.17 and '$290 billed yearly'" }, async () => {
      const growth = page.getByRole("article", { name: "Growth" });
      if (!(await growth.getByText("$29").count())) throw new Error("Growth is not $29");
      await page.getByRole("switch", { name: "Bill annually" }).click();
      await growth.getByText("$24.17").waitFor({ timeout: 5000 });
      await growth.getByText(/\$290 billed yearly/).waitFor({ timeout: 5000 });
      return { actual: "Growth $29 → $24.17, $290 billed yearly", evidence: await rec.shot(page, "pricing-annual") };
    }, fail);

    await rec.tc("V7", "Pricing: comparison and FAQ", { action: "read the table; open 'Is there a per-order fee?'", expected: "Company accounts row; the answer opens" }, async () => {
      const row = page.getByRole("table").getByRole("row", { name: /Company accounts/ });
      const rowText = await row.innerText();
      await page.getByText("Is there a per-order fee?").click();
      await page.getByText(/Mannon is one flat monthly price/).waitFor();
      return { actual: `"${rowText.replace(/\s+/g, " ")}"; FAQ opened` };
    }, fail);

    await rec.tc("V10", "Demo hub and merchant tour", { action: "open /demo; open /demo/tour; Next, ArrowRight, ArrowLeft", expected: "hub cards; Step 1 → 2 → 3 → 2" }, async () => {
      await page.goto(`${L}/demo`, { waitUntil: "networkidle" });
      const cards = await page.locator(".demo-card").count();
      await page.goto(`${L}/demo/tour`, { waitUntil: "networkidle" });
      const step = page.getByText(/^Step \d+ of \d+$/);
      await page.getByRole("button", { name: "Next →" }).click();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowLeft");
      const t = await step.innerText();
      if (!/^Step 2 of/.test(t)) throw new Error(`tour shows "${t}"`);
      return { actual: `${cards} hub cards; tour at "${t}"` };
    }, fail);
  } finally {
    await context.close();
  }

  // V11 + V12 — every public page at phone width: no sideways scroll, no errors, images ok.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  const perr = [];
  pp.on("pageerror", (e) => perr.push(String(e)));
  pp.on("console", (m) => { if (m.type() === "error") perr.push(m.text()); });
  for (const path of ["/", "/pricing", "/demo/store", "/demo", "/demo/tour", "/privacy"]) {
    await rec.tc("V11", `Phone width ${path}`, { action: `open ${L}${path} at 390 px; scroll to the end`, expected: "no sideways scroll, no console errors, no broken images, every image has alt text" }, async () => {
      // A dropped connection (Chrome's net::ERR_HTTP2_PING_FAILED, ERR_NETWORK_CHANGED, …)
      // is the tester's network, not the page: look once more before judging.
      const NET_BLIP = /net::ERR_(HTTP2_PING_FAILED|NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|TIMED_OUT|NETWORK_IO_SUSPENDED|HTTP2_PROTOCOL_ERROR)/;
      let note = "";
      for (let attempt = 1; attempt <= 2; attempt++) {
        perr.length = 0;
        await pp.goto(L + path, { waitUntil: "networkidle" });
        await pp.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 50)); } window.scrollTo(0, 0); });
        await pp.waitForTimeout(500);
        if (attempt === 1 && perr.length && perr.every((e) => NET_BLIP.test(e))) { note = ` (first load hit a network blip: ${perr[0].match(NET_BLIP)[0]}; retried)`; continue; }
        break;
      }
      const m = await pp.evaluate(() => ({
        over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")),
        noAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).map((i) => i.getAttribute("src")),
        lang: document.documentElement.lang,
      }));
      const problems = [];
      if (m.over) problems.push("scrolls sideways");
      if (m.broken.length) problems.push(`broken images ${m.broken.join(", ")}`);
      if (m.noAlt.length) problems.push(`images without alt ${m.noAlt.join(", ")}`);
      if (perr.length) problems.push(`console: ${perr[0].slice(0, 100)}`);
      if (!m.lang) problems.push("<html> has no lang");
      if (problems.length) throw new Error(problems.join("; "));
      return { actual: `fits, no errors, images ok${note}`, evidence: path === "/" ? await rec.shot(pp, "home-phone") : null };
    }, () => rec.shot(pp, `phone-${path}`));
  }
  if (errors.length) rec.add({ id: "V12", name: "No console errors on the desktop walk", action: "listen for page errors", expected: "none", status: "FAIL", actual: errors.slice(0, 3).join(" | ") });
  else rec.add({ id: "V12", name: "No console errors on the desktop walk", action: "listen for page errors", expected: "none", status: "PASS", actual: "none" });
  await phone.close();
  await browser.close();
}
