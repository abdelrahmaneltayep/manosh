#!/usr/bin/env node
/*
 * Storefront end-to-end test — run from your own machine against the live store.
 *
 *   npm run test:storefront                 shopper side only
 *   npm run test:storefront -- --admin      plus: check each submission landed in the admin
 *   npm run test:storefront -- --headed     watch the browser
 *   npm run test:storefront -- --admin --gate-guests
 *                                           first turn on price gating for guests
 *                                           (Mannon → Price rules: logged-out visitors, hide price)
 *
 * Shopper side (a fresh browser, like a real visitor):
 *   1. opens the storefront (enters the store password if the store has one)
 *   2. finds a product page carrying Mannon's blocks
 *   3. checks each block is on the page and visible (review 5.1.2)
 *   4. Request a Quote → fills the modal → sends → reads the confirmation
 *   5. Add to Quote → drawer → sends → reads the confirmation
 *   6. Make an Offer → offers 80% of list → sends → reads the outcome
 *   7. Convert Cart to Quote → adds the product to the cart → sends from /cart
 *   8. Price gate → reports what a guest sees
 * Admin side (--admin): attaches to a Chrome you are signed in to (port 9222,
 * the same profile as the screencast recorder) and looks for this run's tag in
 * Mannon → Quotes → Requests and Mannon → Offers.
 *
 * Every submission carries a run tag (qa+<run>@example.com, "QA Storefront <run>")
 * so it is easy to find and decline afterwards. Nothing is charged: requests and
 * offers only create entries for the merchant to review.
 *
 * Env (all optional):
 *   MANNON_STORE                 default mannon-9iu9ewku.myshopify.com
 *   MANNON_STOREFRONT_PASSWORD   the Online Store password (asked for if needed)
 *   MANNON_PRODUCT_URL           a product page with the blocks (else auto-found)
 *   MANNON_APP_HANDLE            default mannon
 *   MANNON_CDP                   default http://127.0.0.1:9222
 *   MANNON_QA_EMAIL              shopper email (a company contact's, for ordering)
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = new Set(process.argv.slice(2));
const ADMIN = args.has("--admin");
const HEADED = args.has("--headed");
const GATE = args.has("--gate-guests");
const STORE = (process.env.MANNON_STORE || "mannon-9iu9ewku.myshopify.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const STORE_URL = /^(localhost|127\.)/.test(STORE) ? `http://${STORE}` : `https://${STORE}`;
const APP_HANDLE = process.env.MANNON_APP_HANDLE || "mannon";
const CDP = process.env.MANNON_CDP || "http://127.0.0.1:9222";
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const RUN = process.env.MANNON_QA_RUN || `sf${stamp}`;
// MANNON_QA_EMAIL: send as a real company contact (Customers → Companies) so the
// merchant and buyer steps can price and order the request. Default: a new address.
const EMAIL = process.env.MANNON_QA_EMAIL || `qa+${RUN}@example.com`;
const COMPANY = `QA Storefront ${RUN}`;
const OUT = process.env.MANNON_QA_OUT || join(process.cwd(), "qa-storefront", RUN);
mkdirSync(OUT, { recursive: true });

const results = [];
const api = [];
let shotN = 0;
function record(id, name, status, detail = "") {
  results.push({ id, name, status, detail });
  const mark = { PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP", INFO: "INFO" }[status];
  console.log(`${id.padEnd(4)} ${mark.padEnd(4)} ${name}${detail ? `  —  ${detail}` : ""}`);
}
async function shot(page, name) {
  shotN += 1;
  const file = `${String(shotN).padStart(2, "0")}-${name}.png`;
  try { await page.screenshot({ path: join(OUT, file) }); } catch { /* page gone */ }
  return file;
}
function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastApi = (frag) => [...api].reverse().find((a) => a.url.includes(frag));

/** Wait for a status line to settle on something other than "Sending…". */
async function settled(locator, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = ((await locator.textContent().catch(() => "")) || "").trim();
    if (t && !/^Sending/.test(t)) return t;
    await sleep(250);
  }
  return "";
}

/** Click submit and wait for this form's own POST response (no race with the page's message). */
async function submitAndWait(page, form, pathFrag) {
  const respP = page.waitForResponse((r) => r.url().includes(pathFrag) && r.request().method() === "POST", { timeout: 25000 }).catch(() => null);
  await form.locator("[type='submit']").click();
  const resp = await respP;
  if (!resp) return null;
  let body = null;
  try { body = await resp.json(); } catch { /* not json */ }
  return { status: resp.status(), body };
}

/** Fill any merchant-built required fields (cf_*) with sample values. */
async function fillCustomFields(form) {
  const fields = form.locator("[name^='cf_']");
  const n = await fields.count();
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    if (!(await f.isVisible().catch(() => false))) continue;
    const tag = await f.evaluate((el) => el.tagName.toLowerCase());
    const type = (await f.getAttribute("type")) || "";
    const required = (await f.getAttribute("required")) !== null;
    if (!required) continue;
    if (tag === "select") {
      const opts = await f.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      if (opts[0]) await f.selectOption(opts[0]);
    } else if (type === "checkbox") await f.check();
    else if (type === "number") await f.fill("1");
    else if (type === "email") await f.fill(EMAIL);
    else if (type === "tel") await f.fill("+10000000000");
    else if (type === "date") await f.fill(new Date().toISOString().slice(0, 10));
    else if (type === "file") continue;
    else await f.fill(`QA ${RUN}`);
  }
}

async function passwordGate(page) {
  if (!/\/password/.test(page.url())) return true;
  let pw = process.env.MANNON_STOREFRONT_PASSWORD;
  if (!pw) pw = await ask("The store has a password page. Online Store password: ");
  const input = page.locator("input[type='password']").first();
  await input.fill(pw);
  await input.press("Enter");
  await page.waitForLoadState("domcontentloaded");
  await sleep(1200);
  return !/\/password/.test(page.url());
}

const BLOCKS = [
  { key: "rfq", name: "Request a Quote", root: "[data-mannon-qw]", btn: "[data-mannon-qw-open]", required: true, cfg: "/api/quote-widget-config", where: "the widget toggle in Mannon → Quote forms" },
  { key: "atq", name: "Add to Quote", root: "[data-mannon-capture] [data-mannon-atq-add]", btn: "[data-mannon-atq-add]", required: true, cfg: "/api/quote-capture-config", where: "the widget toggle in Mannon → Quote forms, or MANNON_FF_QUOTE_CAPTURE on the server" },
  { key: "mao", name: "Make an Offer", root: "[data-mannon-mao]", btn: "[data-mannon-mao-open]", required: true, cfg: "/api/offer-config", where: "MANNON_FF_MAKE_AN_OFFER on the server" },
  { key: "pg", name: "Price / ATC gate", root: "[data-mannon-pg]", btn: null, required: false },
];

async function blocksOn(page) {
  return page.evaluate((bs) => Object.fromEntries(bs.map((b) => [b.key, Boolean(document.querySelector(b.root))])), BLOCKS);
}

async function findProduct(page) {
  if (process.env.MANNON_PRODUCT_URL) {
    const u = process.env.MANNON_PRODUCT_URL;
    return u.startsWith("http") ? u : STORE_URL + u;
  }
  const res = await page.request.get(`${STORE_URL}/products.json?limit=30`).catch(() => null);
  const products = res && res.ok() ? (await res.json()).products || [] : [];
  let best = null;
  for (const p of products.slice(0, 15)) {
    const url = `${STORE_URL}/products/${p.handle}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const on = await blocksOn(page);
    const score = Object.values(on).filter(Boolean).length;
    if (!best || score > best.score) best = { url, score };
    if (on.rfq && on.atq && on.mao) break;
  }
  return best && best.score > 0 ? best.url : null;
}

async function shopperSide() {
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.on("response", async (r) => {
    const url = r.url();
    if (!/\/api\/(quote-request|offer|quote-widget-config|quote-capture-config|offer-config|price-visibility|quote-form)/.test(url)) return;
    let body = null;
    try { body = await r.json(); } catch { /* not json */ }
    api.push({ url, status: r.status(), method: r.request().method(), body });
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  let appUrl = null;

  try {
    // S1 — storefront reachable
    const r = await page.goto(STORE_URL + "/", { waitUntil: "domcontentloaded" }).catch((e) => ({ error: e }));
    if (!r || r.error) { record("S1", "Storefront opens", "FAIL", String(r?.error || "no response")); return { appUrl }; }
    const through = await passwordGate(page);
    if (!through) { record("S1", "Storefront opens", "FAIL", "the store password was not accepted"); await shot(page, "password"); return { appUrl }; }
    record("S1", "Storefront opens", "PASS", STORE_URL);

    // S2 — a product page with the blocks
    const productUrl = await findProduct(page);
    if (!productUrl) {
      record("S2", "Product page with Mannon blocks", "FAIL", "no product page carries a Mannon block. Add them in Online Store → Customize → product template → Add block");
      await shot(page, "no-blocks");
      return { appUrl };
    }
    await page.goto(productUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(2500); // blocks load async and read their config
    record("S2", "Product page with Mannon blocks", "PASS", productUrl);
    appUrl = await page.evaluate(() => {
      const el = document.querySelector("[data-app-url]");
      return el ? el.getAttribute("data-app-url") : null;
    });
    record("S3", "Blocks point at the app", appUrl && /manosh\.fly\.dev|127\.0\.0\.1|localhost/.test(appUrl) ? "PASS" : "FAIL", appUrl || "no data-app-url");
    await shot(page, "product");

    // S4 — every block present and visible
    const on = await blocksOn(page);
    for (const b of BLOCKS) {
      if (!on[b.key]) {
        record(`B-${b.key}`, `${b.name} block on the page`, b.required ? "FAIL" : "SKIP", "not on this product template — add it in the theme editor");
        continue;
      }
      if (!b.btn) { record(`B-${b.key}`, `${b.name} block on the page`, "PASS", "present (it only shows when gating applies)"); continue; }
      const vis = await page.locator(b.btn).first().isVisible();
      const said = b.cfg ? lastApi(b.cfg) : null;
      const why = said ? `the app answered ${said.status} enabled=${said.body?.enabled} — check ${b.where}` : `no answer from ${b.cfg} — check the app URL and CORS`;
      record(`B-${b.key}`, `${b.name} block visible to shoppers`, vis ? "PASS" : "FAIL", vis ? `button "${(await page.locator(b.btn).first().textContent()).trim()}"` : `on the page but hidden: ${why}`);
    }
    const cfg = lastApi("/api/quote-widget-config");
    if (cfg) record("S5", "Widget config served cross-origin", cfg.status === 200 ? "PASS" : "FAIL", `HTTP ${cfg.status}, enabled=${cfg.body?.enabled}`);

    // T1 — Request a Quote
    if (on.rfq && (await page.locator("[data-mannon-qw-open]").first().isVisible())) {
      await page.locator("[data-mannon-qw-open]").first().click();
      const modal = page.locator(".mannon-qw-modal");
      await modal.waitFor({ timeout: 8000 });
      const form = modal.locator("form");
      await form.locator("[name='email']").fill(EMAIL);
      if (await form.locator("[name='companyName']").count()) await form.locator("[name='companyName']").fill(COMPANY);
      if (await form.locator("[name='quantity']").count()) await form.locator("[name='quantity']").fill("3");
      if (await form.locator("[name='note']").count()) await form.locator("[name='note']").fill(`Storefront test ${RUN}: Request a Quote`);
      await fillCustomFields(form);
      await sleep(1600); // stay above the 1.2 s anti-bot threshold
      const res = await submitAndWait(page, form, "/api/quote-request");
      const msg = await settled(form.locator(".mannon-qw-msg"));
      const ok = res && res.status === 200 && res.body?.ok && !/wrong|error/i.test(msg);
      await shot(page, "request-a-quote");
      record("T1", "Request a Quote: send from the product page", ok ? "PASS" : "FAIL", `"${msg || "no message"}" · API ${res ? `${res.status} ok=${res.body?.ok}` : "not called"}`);
      await modal.locator(".mannon-qw-x").click().catch(() => {});
    } else record("T1", "Request a Quote: send from the product page", "SKIP", "button not available");

    // T2 — Add to Quote
    if (on.atq && (await page.locator("[data-mannon-atq-add]").first().isVisible())) {
      await page.locator("[data-mannon-atq-add]").first().click();
      const panel = page.locator(".mannon-cap-panel");
      await panel.waitFor({ state: "visible", timeout: 8000 });
      const launcher = ((await page.locator(".mannon-cap-launcher").textContent().catch(() => "")) || "").trim();
      const rows = await panel.locator(".mannon-cap-row").count();
      const form = panel.locator("form");
      await form.locator("[name='email']").fill(EMAIL);
      await form.locator("[name='note']").fill(`Storefront test ${RUN}: Add to Quote · ${COMPANY}`);
      await sleep(1600);
      const res = await submitAndWait(page, form, "/api/quote-request");
      const msg = await settled(form.locator(".mannon-cap-msg"));
      const ok = res && res.status === 200 && res.body?.ok && /Thanks/i.test(msg);
      await shot(page, "add-to-quote");
      record("T2", "Add to Quote: drawer, then send", ok ? "PASS" : "FAIL", `${rows} line(s), launcher "${launcher}" · "${msg || "no message"}"`);
      await panel.locator(".mannon-cap-x").click().catch(() => {});
    } else record("T2", "Add to Quote: drawer, then send", "SKIP", "button not available");

    // T3 — Make an Offer
    if (on.mao && (await page.locator("[data-mannon-mao-open]").first().isVisible())) {
      await page.locator("[data-mannon-mao-open]").first().click();
      const modal = page.locator(".mannon-mao-modal");
      await modal.waitFor({ timeout: 8000 });
      const listText = ((await modal.locator(".mannon-mao-list").textContent().catch(() => "")) || "");
      const list = parseFloat((listText.match(/([\d.,]+)/) || [])[1]?.replace(/,/g, "") || "0");
      const offer = list > 0 ? (Math.round(list * 0.8 * 100) / 100).toFixed(2) : "1.00";
      const form = modal.locator("form");
      await form.locator("[name='email']").fill(EMAIL);
      await form.locator("[name='quantity']").fill("2");
      await form.locator("[name='offer']").fill(offer);
      if (await form.locator("[name='note']").count()) await form.locator("[name='note']").fill(`Storefront test ${RUN}: Make an Offer · ${COMPANY}`);
      await fillCustomFields(form);
      await sleep(1600);
      const res = await submitAndWait(page, form, "/api/offer");
      const msg = await settled(form.locator(".mannon-mao-msg"));
      const ok = res && res.status === 200 && res.body?.ok && !/wrong|error/i.test(msg);
      await shot(page, "make-an-offer");
      record("T3", "Make an Offer: 80% of list", ok ? "PASS" : "FAIL", `offer ${offer} on list ${list || "?"} · outcome ${res?.body?.outcome || "?"} · "${msg || "no message"}"`);
      await modal.locator(".mannon-mao-x").click().catch(() => {});
    } else record("T3", "Make an Offer: 80% of list", "SKIP", "button not available");

    // T4 — Convert Cart to Quote
    const variant = await page.evaluate(async () => {
      try { const r = await fetch(location.pathname.replace(/\/$/, "") + ".js"); const p = await r.json(); return p.variants && p.variants[0] && p.variants[0].id; } catch { return null; }
    });
    if (variant) {
      await page.evaluate(async (id) => {
        await fetch("/cart/add.js", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ id, quantity: 4 }] }) });
      }, variant);
      await page.goto(STORE_URL + "/cart", { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(2000);
      const c2q = page.locator("[data-mannon-c2q-btn]").first();
      if ((await c2q.count()) && (await c2q.isVisible())) {
        await c2q.click();
        const panel = page.locator(".mannon-cap-panel");
        await panel.waitFor({ state: "visible", timeout: 8000 });
        const rows = await panel.locator(".mannon-cap-row").count();
        const form = panel.locator("form");
        await form.locator("[name='email']").fill(EMAIL);
        await form.locator("[name='note']").fill(`Storefront test ${RUN}: Cart to Quote · ${COMPANY}`);
        await sleep(1600);
        const res = await submitAndWait(page, form, "/api/quote-request");
        const msg = await settled(form.locator(".mannon-cap-msg"));
        const ok = res && res.status === 200 && res.body?.ok && /Thanks/i.test(msg);
        await shot(page, "cart-to-quote");
        record("T4", "Convert Cart to Quote from /cart", ok ? "PASS" : "FAIL", `${rows} cart line(s) · "${msg || "no message"}"`);
      } else {
        await shot(page, "cart");
        record("T4", "Convert Cart to Quote from /cart", "SKIP", "block not on the cart template — add it in the theme editor (cart page)");
      }
      await page.evaluate(() => fetch("/cart/clear.js", { method: "POST" })).catch(() => {});
    } else record("T4", "Convert Cart to Quote from /cart", "SKIP", "could not read the product's variant");

    // T5 — Price gate as a guest
    if (on.pg) {
      const guest = await browser.newContext({ storageState: await context.storageState() });
      const gp = await guest.newPage();
      const pv = gp.waitForResponse((r) => r.url().includes("/api/price-visibility"), { timeout: 12000 }).catch(() => null);
      await gp.goto(productUrl, { waitUntil: "domcontentloaded" });
      const resp = await pv;
      const body = resp ? await resp.json().catch(() => null) : null;
      await sleep(1500);
      const ctaVisible = await gp.locator("[data-mannon-pg-cta]").first().isVisible().catch(() => false);
      await shot(gp, "price-gate-guest");
      if (!resp) record("T5", "Price gate for a guest", "FAIL", "the gate never asked the app (script blocked?)");
      else if (body && (body.hidePrice || body.hideAtc)) record("T5", "Price gate for a guest", ctaVisible ? "PASS" : "FAIL", `hidePrice=${body.hidePrice} hideAtc=${body.hideAtc} · CTA ${ctaVisible ? "shown" : "missing"}`);
      else record("T5", "Price gate for a guest", GATE ? "FAIL" : "INFO", GATE ? "gating was turned on but the app still shows the price to guests" : "gating is off for guests, so prices stay visible (run with --gate-guests to turn it on)");
      await guest.close();
    } else record("T5", "Price gate for a guest", "SKIP", "block not on this product template");

    if (pageErrors.length) record("S6", "No script errors on the storefront", "INFO", pageErrors.slice(0, 2).join(" | "));
    else record("S6", "No script errors on the storefront", "PASS");
  } catch (e) {
    record("ERR", "Shopper side stopped", "FAIL", String(e).split("\n")[0]);
    await shot(page, "error");
  } finally {
    await browser.close();
  }
  return { appUrl };
}

async function cdpInfo(url) {
  try {
    const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
/** Something on the port that is a real Chrome (not an Electron app like Slack, Figma or VS Code). */
const isChrome = (v) => Boolean(v) && /Chrome|Chromium/.test(v.Browser || "") && !/Electron/i.test(v["User-Agent"] || "");

async function startChrome(port) {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform !== "darwin" || !existsSync(chrome)) return false;
  console.log(`Starting your Chrome (profile ~/mannon-chrome, port ${port}) so the admin check can use your sign-in…`);
  spawn(chrome, [`--user-data-dir=${join(homedir(), "mannon-chrome")}`, `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 30; i++) { if (isChrome(await cdpInfo(`http://127.0.0.1:${port}`))) return true; await sleep(500); }
  return false;
}

/** Find a Chrome to attach to: MANNON_CDP if it is Chrome, else our own on 9333. */
async function attachChrome() {
  const first = await cdpInfo(CDP);
  const tried = [];
  const candidates = [];
  if (isChrome(first)) candidates.push(CDP);
  else if (first) tried.push(`${CDP} is ${/Electron/i.test(first["User-Agent"] || "") ? "an Electron app" : first.Browser || "not Chrome"} (${(first["User-Agent"] || "").replace(/.*\) /, "").slice(0, 60)})`);
  const own = "http://127.0.0.1:9333";
  if (!candidates.length && (isChrome(await cdpInfo(own)) || (await startChrome(9333)))) candidates.push(own);
  if (!candidates.length && !first && (await startChrome(9222))) candidates.push(CDP);
  for (const url of candidates) {
    try { return { browser: await chromium.connectOverCDP(url), url }; }
    catch (e) { tried.push(`${url}: ${String(e.message || e).split("\n")[0]}`); }
  }
  return { browser: null, why: tried.length ? tried.join("; ") : "no Chrome could be started" };
}

async function attachAdmin() {
  const { browser, url, why } = await attachChrome();
  if (!browser) {
    record("A0", "Attach to your signed-in Chrome", "FAIL", `${why}. If Chrome with the ~/mannon-chrome profile is already open without a debug port, quit it and run again. To see what holds the port: lsof -nP -iTCP:9222 -sTCP:LISTEN`);
    return null;
  }
  record("A0", "Attach to your signed-in Chrome", "PASS", url);
  return browser;
}

const storeHandle = () => STORE.replace(/\.myshopify\.com$/, "");

/** Open a Mannon admin page and return its app iframe (waits for sign-in). */
async function openAppPage(page, path, appHost) {
  const url = `https://admin.shopify.com/store/${storeHandle()}/apps/${APP_HANDLE}${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (/accounts\.shopify\.com|\/login/.test(page.url())) {
    console.log("Sign in to Shopify in the Chrome window; waiting up to 5 minutes…");
    await page.waitForURL(/admin\.shopify\.com\/store\//, { timeout: 300000 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  const t0 = Date.now();
  let frame = null;
  while (!frame && Date.now() - t0 < 40000) { frame = page.frames().find((f) => f.url().includes(appHost)); if (!frame) await sleep(500); }
  if (frame) { await frame.waitForLoadState("networkidle").catch(() => {}); await sleep(1500); }
  return frame;
}

/** Mannon → Price rules: make sure an active "Logged-out visitors · hide price" rule exists. */
async function gateGuests(browser, appHost) {
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = await context.newPage();
  try {
    const frame = await openAppPage(page, "/app/price-rules", appHost);
    if (!frame) { record("G1", "Price gating for guests is on", "FAIL", "the Price rules page did not load (is the price-rules feature on for this shop?)"); await shot(page, "gate-no-page"); return; }
    const existing = await frame.evaluate(() =>
      Array.from(document.querySelectorAll("tr")).some((r) => /Logged-out visitors/.test(r.textContent || "") && /price/.test(r.textContent || "") && /Active/.test(r.textContent || "")),
    );
    if (existing) { record("G1", "Price gating for guests is on", "PASS", "an active Logged-out visitors rule already hides the price"); await shot(page, "gate-already-on"); return; }
    const scope = frame.locator("select[name='scope']");
    await scope.selectOption("LOGGED_OUT");
    const hide = frame.getByLabel("Hide price", { exact: true });
    if (!(await hide.isChecked())) await hide.check();
    const add = frame.getByRole("button", { name: "Add rule" });
    if (!(await add.count())) {
      const note = ((await frame.locator(".Polaris-Banner").last().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      await shot(page, "gate-locked");
      record("G1", "Price gating for guests is on", "FAIL", `the page will not add the rule: "${note || "no Add rule button"}" — deploy the latest build (the plan check on this page was fixed) and run again`);
      return;
    }
    await add.click();
    await frame.getByText(/Rule saved\.|Targeting by|needs the/).first().waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(1000);
    const saved = await frame.getByText("Rule saved.").count();
    await shot(page, "gate-saved");
    record("G1", "Price gating for guests is on", saved ? "PASS" : "FAIL", saved ? "added: Logged-out visitors · hide price · \"Request a Quote\"" : "no confirmation after Add rule (see the screenshot)");
  } finally {
    await page.close().catch(() => {});
  }
}

async function adminSide(browser, appUrl) {
  const appHost = appUrl ? new URL(appUrl).host : "manosh.fly.dev";
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = await context.newPage();
  const findIn = async (path, label, id, expectAtLeast) => {
    let count = 0;
    for (let attempt = 0; attempt < 4 && count < expectAtLeast; attempt++) {
      if (attempt) await sleep(12000);
      const frame = await openAppPage(page, path, appHost);
      if (!frame) continue;
      // Count rows (table rows / list items / cards) that mention the run tag,
      // not raw text matches: one entry shows the tag in its email, company and note.
      count = await frame.evaluate((tag) => {
        const rows = Array.from(document.querySelectorAll("tr, li, [role='row'], .Polaris-ResourceItem, .Polaris-IndexTable__TableRow"));
        const hits = rows.filter((r) => (r.textContent || "").includes(tag));
        return hits.filter((r) => !hits.some((o) => o !== r && r.contains(o))).length;
      }, RUN).catch(() => 0);
      if (!count) {
        const text = (await frame.locator("body").innerText().catch(() => "")) || "";
        count = (text.match(new RegExp(`qa\\+${RUN}@example\\.com`, "gi")) || []).length;
      }
    }
    await shot(page, `admin-${id}`);
    record(id, label, count >= expectAtLeast ? "PASS" : "FAIL", count ? `found ${count} entr${count === 1 ? "y" : "ies"} tagged ${RUN} (expected ${expectAtLeast})` : `nothing tagged ${RUN} yet`);
  };
  try {
    const quoteSends = results.filter((r) => ["T1", "T2", "T4"].includes(r.id) && r.status === "PASS").length;
    const offerSent = results.some((r) => r.id === "T3" && r.status === "PASS");
    if (quoteSends) await findIn("/app/quote-requests", "Requests reach Mannon → Quotes → Requests", "A1", quoteSends);
    else record("A1", "Requests reach Mannon → Quotes → Requests", "SKIP", "no request was sent");
    if (offerSent) await findIn("/app/offers", "Offer reaches Mannon → Offers", "A2", 1);
    else record("A2", "Offer reaches Mannon → Offers", "SKIP", "no offer was sent");
  } catch (e) {
    record("AERR", "Admin side stopped", "FAIL", String(e).split("\n")[0]);
    await shot(page, "admin-error");
  } finally {
    await page.close().catch(() => {});
  }
}

console.log(`Mannon storefront test · run ${RUN} · ${STORE_URL}`);
console.log(`Submissions are tagged ${EMAIL} / "${COMPANY}"\n`);
let adminBrowser = null;
if (ADMIN || GATE) {
  try { adminBrowser = await attachAdmin(); } catch (e) { record("A0", "Attach to your signed-in Chrome", "FAIL", String(e.message || e).split("\n")[0]); }
}
if (GATE && adminBrowser) {
  try { await gateGuests(adminBrowser, "manosh.fly.dev"); } catch (e) { record("G1", "Price gating for guests is on", "FAIL", String(e.message || e).split("\n")[0]); }
  console.log("");
}
const { appUrl } = await shopperSide();
if (ADMIN && adminBrowser) {
  console.log("");
  try { await adminSide(adminBrowser, appUrl); } catch (e) { record("AERR", "Admin side stopped", "FAIL", String(e.message || e).split("\n")[0]); }
}
if (adminBrowser) await adminBrowser.close().catch(() => {}); // disconnects only; your Chrome stays open

const counts = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const summary = `PASS ${counts.PASS || 0} · FAIL ${counts.FAIL || 0} · SKIP ${counts.SKIP || 0} · INFO ${counts.INFO || 0}`;
const md = [
  `# Storefront test ${RUN}`,
  "",
  `Store: ${STORE_URL} · tag: \`${EMAIL}\` / "${COMPANY}" · admin check: ${ADMIN ? "yes" : "no"}`,
  "",
  `**${summary}**`,
  "",
  "| Step | Result | What | Detail |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${r.status} | ${r.name} | ${String(r.detail).replace(/\|/g, "/")} |`),
  "",
  "## Storefront API calls seen",
  "",
  ...api.map((a) => `- ${a.method} ${a.url.replace(/\?.*/, "")} → ${a.status}${a.body && "ok" in a.body ? ` ok=${a.body.ok}` : ""}${a.body?.outcome ? ` outcome=${a.body.outcome}` : ""}`),
  "",
  "Clean-up: decline or delete the entries tagged with the run tag in Mannon → Quotes → Requests and Mannon → Offers.",
].join("\n");
writeFileSync(join(OUT, "report.md"), md);
writeFileSync(join(OUT, "results.json"), JSON.stringify({ run: RUN, email: EMAIL, company: COMPANY, results, api }, null, 2));
console.log(`\n${summary}\nReport and screenshots: ${OUT}`);
process.exit(counts.FAIL ? 1 : 0);
