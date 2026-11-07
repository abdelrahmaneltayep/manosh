#!/usr/bin/env node
/*
 * App Store listing screenshots (SUBMISSION-KIT.md → Screenshots), captured from
 * the live app and composed to Shopify's spec: 1600×900 (and a 3200×1800 @2x),
 * Mannon's own UI only (no browser bar, no Shopify admin chrome), a solid
 * background and one headline, alt text alongside.
 *
 *   npm run listing:shots                  shots 3, 4, 5, 6 (live demo, buyer portal, storefront)
 *   npm run listing:shots -- --admin       also shots 1 and 2 (your signed-in Chrome, Shopify Admin)
 *   npm run listing:shots -- --only=1,2    just some shots
 *
 * Env: MANNON_LIVE_URL (https://manosh.fly.dev), MANNON_STORE
 * (mannon-9iu9ewku.myshopify.com), MANNON_STOREFRONT_PASSWORD, MANNON_PRODUCT_URL,
 * MANNON_APP_HANDLE (mannon), MANNON_CDP, MANNON_SHOT_SKUS ("sku-managed-1,sku-hosted-1").
 *
 * What it writes: shots 1–2 convert one storefront request into a quote and
 * recalculate it (nothing is sent to the buyer); shot 3 opens the accept
 * confirm panel on the public demo and stops before Confirm; shot 5 reads a PO
 * and stops before "Request quote for these items". Output: listing-shots/<stamp>/.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attachChrome, openApp, pickNet30, sleep, textOf } from "../qa/lib.mjs";

const argv = process.argv.slice(2);
const ADMIN = argv.includes("--admin");
const ONLY = (argv.find((a) => a.startsWith("--only=")) || "").split("=")[1]?.split(",").map(Number) || null;
const want = (n) => (ONLY ? ONLY.includes(n) : n >= 3 || ADMIN);

const LIVE = (process.env.MANNON_LIVE_URL || "https://manosh.fly.dev").replace(/\/$/, "");
const STORE = (process.env.MANNON_STORE || "mannon-9iu9ewku.myshopify.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const SKUS = (process.env.MANNON_SHOT_SKUS || "sku-managed-1,sku-hosted-1").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = join(process.cwd(), "listing-shots", new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12));
mkdirSync(join(OUT, "raw"), { recursive: true });

// The shot list, kept in step with SUBMISSION-KIT.md.
const SHOTS = {
  1: { file: "01-quote-shopify-totals", headline: "Counter each line. Shopify prices the quote.", alt: "Quote page with editable prices and Shopify-calculated totals" },
  2: { file: "02-draft-with-claude", headline: "Claude suggests a counter. You decide what to send.", alt: "Claude's suggested counter price and buyer message on a quote" },
  3: { file: "03-buyer-accept", headline: "Buyers accept with a secure link. No password.", alt: "Buyer accepting a countered quote on Net 30 payment terms" },
  4: { file: "04-storefront-blocks", headline: "Quotes and offers from your product pages.", alt: "Product page with Request a Quote and Make an Offer buttons" },
  5: { file: "05-order-pad", headline: "Paste a PO. Claude matches it to your catalog.", alt: "Order pad matching a pasted purchase order to catalog items" },
  6: { file: "06-mobile-reorder", headline: "Reorder a past order in one tap.", alt: "Mobile buyer portal with quotes and a one-tap reorder card" },
};
const done = [];
const log = (n, msg) => console.log(`${String(n).padEnd(2)} ${msg}`);

/** Compose a raw capture onto the listing canvas: solid background, headline, framed screenshot. */
async function compose(browser, n, rawPath, { phone = false } = {}) {
  const { file, headline } = SHOTS[n];
  const img = `data:image/png;base64,${readFileSync(rawPath).toString("base64")}`;
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1600px;height:900px;background:#F6F5FF;overflow:hidden}
  body{display:flex;flex-direction:column;align-items:center;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  h1{margin:52px 0 30px;font-size:46px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;color:#1C1D2B;text-align:center}
  .shot{flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;padding:0 80px 56px;box-sizing:border-box;width:100%}
  img{max-width:100%;max-height:100%;border-radius:${phone ? 28 : 14}px;box-shadow:0 18px 50px rgba(67,56,202,.16),0 2px 8px rgba(28,29,43,.08);border:1px solid #E6E6EF;background:#fff}
</style></head><body><h1>${headline}</h1><div class="shot"><img src="${img}" alt=""></div></body></html>`;
  for (const [scale, suffix] of [[1, ""], [2, "@2x"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: scale });
    const p = await ctx.newPage();
    await p.setContent(html, { waitUntil: "networkidle" }).catch(() => {});
    await p.evaluate(() => document.fonts.ready).catch(() => {});
    await p.screenshot({ path: join(OUT, `${file}${suffix}.png`) });
    await ctx.close();
  }
  done.push(n);
  log(n, `${file}.png  —  ${headline}`);
}

/** A locator's box in page coordinates (boundingBox is viewport-relative; fullPage clips are page-relative). */
async function pageBox(page, locator) {
  const b = await locator.boundingBox();
  if (!b) return null;
  const { sx, sy } = await page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY }));
  return { x: b.x + sx, y: b.y + sy, width: b.width, height: b.height };
}

/** Screenshot the union of some boxes plus padding, in page coordinates. */
async function clipUnion(page, boxes, path, pad = 20) {
  const bs = boxes.filter(Boolean);
  const x = Math.max(0, Math.min(...bs.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...bs.map((b) => b.y)) - pad);
  const r = Math.max(...bs.map((b) => b.x + b.width)) + pad;
  const btm = Math.max(...bs.map((b) => b.y + b.height)) + pad;
  await page.screenshot({ path, clip: { x, y, width: r - x, height: btm - y }, fullPage: true });
}

const HIDE_DEMO_BAR = ".portal-demobar{display:none !important}";

const browser = await chromium.launch({ headless: !argv.includes("--headed") });
try {
  // Shots 3, 5, 6 — the public buyer demo (one demo start; the phone reuses the session).
  if (want(3) || want(5) || want(6)) {
    const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const p = await desk.newPage();
    await p.goto(`${LIVE}/demo`, { waitUntil: "networkidle" });
    await p.getByRole("link", { name: "Open the buyer demo" }).first().click();
    await p.waitForURL(/\/portal/, { timeout: 30000 });
    await p.waitForLoadState("networkidle");
    if (/Too many demo sessions/i.test(await textOf(p))) throw new Error("demo rate limit (5 starts per hour from this network): try again later");
    await p.addStyleTag({ content: HIDE_DEMO_BAR });
    const home = p.url();
    const portalState = await desk.storageState();

    if (want(3)) {
      await p.locator("li.quote-list-row").filter({ has: p.locator(".status-countered") }).first().getByRole("link").first().click();
      await p.getByRole("button", { name: /Accept & create order/ }).waitFor({ timeout: 20000 });
      await p.addStyleTag({ content: HIDE_DEMO_BAR });
      await pickNet30(p);
      await p.getByRole("button", { name: /Accept & create order/ }).click();
      await p.getByRole("button", { name: /Confirm & create order/ }).waitFor({ timeout: 10000 });
      await sleep(400);
      const raw = join(OUT, "raw", "03.png");
      await p.locator(".portal-card").first().screenshot({ path: raw });
      await compose(browser, 3, raw);
    }

    if (want(5)) {
      await p.goto(`${LIVE}/portal/quick-order`, { waitUntil: "networkidle" });
      await p.addStyleTag({ content: HIDE_DEMO_BAR });
      const po = `Hi team, please send for next week:\n${SKUS.map((s, i) => `${[6, 2, 4][i] ?? 1}x ${s}`).join("\n")}\nThanks!`;
      const ta = (await p.getByPlaceholder(/please send/i).count()) ? p.getByPlaceholder(/please send/i).first() : p.locator("textarea").last();
      await ta.fill(po);
      await p.getByRole("button", { name: "Read my order" }).click();
      const submit = p.getByRole("button", { name: /Request quote for these items/ });
      await submit.waitFor({ timeout: 60000 });
      await sleep(800);
      const raw = join(OUT, "raw", "05.png");
      const card = await pageBox(p, p.locator(".portal-card").first());
      const head = await pageBox(p, p.getByText("Paste a PO or email").first());
      const end = await pageBox(p, submit);
      await clipUnion(p, [{ x: card.x + 8, y: head.y - 4, width: card.width - 16, height: 1 }, { x: card.x + 8, y: end.y, width: card.width - 16, height: end.height + 4 }], raw, 16);
      await compose(browser, 5, raw);
    }

    if (want(6)) {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, storageState: portalState });
      const m = await phone.newPage();
      await m.goto(home, { waitUntil: "networkidle" });
      await m.addStyleTag({ content: HIDE_DEMO_BAR });
      await sleep(400);
      const raw = join(OUT, "raw", "06.png");
      // From the top of the portal to just below the last quote row: header, reorder card, quotes.
      const rows = m.locator("li.quote-list-row");
      const last = (await rows.count()) ? await pageBox(m, rows.last()) : null;
      const bottom = last ? last.y + last.height + 18 : 844;
      await m.screenshot({ path: raw, clip: { x: 0, y: 0, width: 390, height: Math.min(bottom, 1100) }, fullPage: true });
      await compose(browser, 6, raw, { phone: true });
      await phone.close();
    }
    await desk.close();
  }

  // Shot 4 — the storefront product page with the Mannon blocks and the quote form open.
  if (want(4)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const product = process.env.MANNON_PRODUCT_URL || `https://${STORE}/products/the-collection-snowboard-liquid`;
    await p.goto(product, { waitUntil: "domcontentloaded" });
    if (/\/password/.test(p.url())) {
      const pw = process.env.MANNON_STOREFRONT_PASSWORD;
      if (!pw) throw new Error("the storefront is password-protected: set MANNON_STOREFRONT_PASSWORD");
      await p.locator('input[type="password"]').first().fill(pw);
      await p.locator('input[type="password"]').first().press("Enter");
      await p.waitForLoadState("networkidle");
      await p.goto(product, { waitUntil: "networkidle" });
    }
    await p.locator("[data-mannon-qw-open]").first().waitFor({ timeout: 20000 });
    await sleep(1200);
    // The product section: the smallest element holding both the product's main
    // image and Mannon's first button (so no header, no related products).
    const sectionBox = await p.evaluate(() => {
      const btn = document.querySelector("[data-mannon-qw-open], [data-mannon-atq-add], [data-mannon-mao-open]");
      const imgs = [...document.images].filter((im) => im.getBoundingClientRect().width > 120);
      imgs.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
      if (!btn || !imgs.length) return null;
      let el = btn;
      while (el && !el.contains(imgs.find((im) => true))) el = el.parentElement;
      // Prefer the ancestor that contains the button and the largest image near it.
      const img = imgs.find((im) => { let a = btn; while (a && !a.contains(im)) a = a.parentElement; return a && a !== document.body && a !== document.documentElement; }) || imgs[0];
      el = btn;
      while (el && !el.contains(img)) el = el.parentElement;
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    });
    if (!sectionBox) throw new Error("couldn't find the product section with the Mannon blocks");
    const boxes = [sectionBox];
    const raw = join(OUT, "raw", "04.png");
    await clipUnion(p, boxes, raw, 32); // the page itself: no browser bar in a Playwright capture
    await compose(browser, 4, raw);
    await ctx.close();
  }

  // Shots 1, 2 — the merchant quote page inside Shopify Admin (your signed-in Chrome), cropped to Mannon's frame.
  if (want(1) || want(2)) {
    const a = await attachChrome();
    if (!a.browser) throw new Error(`shots 1–2 need your signed-in Chrome: ${a.why}`);
    const page = await (a.browser.contexts()[0] || (await a.browser.newContext())).newPage();
    await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
    const app = { store: STORE, appHandle: process.env.MANNON_APP_HANDLE || "mannon", appHost: new URL(LIVE).host };
    try {
      let f = await openApp(page, app, "/app/quote-requests");
      const convert = f.getByRole("button", { name: "Convert to quote" }).first();
      if (!(await convert.count())) throw new Error("no storefront request to convert: send one from a product page first");
      await convert.click();
      let quoteFrame = null;
      for (let i = 0; i < 60 && !quoteFrame; i++) { quoteFrame = page.frames().find((x) => /\/app\/quotes\/[^/?#.]+/.test(x.url())); if (!quoteFrame) await sleep(500); }
      if (!quoteFrame) throw new Error("the quote did not open after Convert to quote");
      f = quoteFrame;
      await f.getByText("Totals from Shopify").first().waitFor({ timeout: 30000 });
      const appFrame = await f.frameElement();

      if (want(1)) {
        const price = f.getByLabel("Unit price").first();
        const v = parseFloat(((await price.inputValue()) || "0").replace(/[^0-9.]/g, ""));
        if (v > 0) await price.fill((Math.round(v * 0.95 * 100) / 100).toFixed(2));
        await f.getByRole("button", { name: "Recalculate with these prices" }).click();
        await f.getByText(/Not saved until you send the counter/).first().waitFor({ timeout: 30000 });
        await sleep(600);
        const raw = join(OUT, "raw", "01.png");
        await appFrame.screenshot({ path: raw });
        await compose(browser, 1, raw);
      }
      if (want(2)) {
        const draft = f.getByRole("button", { name: /Draft all lines with Claude/ }).first();
        if (!(await draft.count())) throw new Error("no ✦ Draft with Claude button (the shop needs Growth or Scale)");
        await draft.click();
        await f.getByRole("button", { name: "Use this price" }).first().waitFor({ timeout: 60000 });
        await f.getByRole("button", { name: "Use this price" }).first().scrollIntoViewIfNeeded();
        await sleep(600);
        const raw = join(OUT, "raw", "02.png");
        await appFrame.screenshot({ path: raw });
        await compose(browser, 2, raw);
      }
    } finally {
      await page.close().catch(() => {});
      await a.browser.close().catch(() => {});
    }
  }
} catch (e) {
  console.error(`Stopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  const alt = Object.entries(SHOTS)
    .filter(([n]) => done.includes(Number(n)))
    .map(([n, s]) => `${n}. ${s.file}.png\n   Headline: ${s.headline}\n   Alt text: ${s.alt}`)
    .join("\n\n");
  writeFileSync(join(OUT, "ALT-TEXT.md"), `# Listing screenshots — alt text\n\nUpload the 1600×900 files in this order; paste each alt text.\n\n${alt}\n`);
  console.log(`\n${done.length} shot(s) in ${OUT}${done.length < 6 ? `  (missing: ${[1, 2, 3, 4, 5, 6].filter((n) => !done.includes(n)).join(", ")})` : ""}`);
}
