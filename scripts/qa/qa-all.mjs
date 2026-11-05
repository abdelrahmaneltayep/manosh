#!/usr/bin/env node
/*
 * Full QA run of Mannon from your terminal: every user flow in
 * docs/qa/test-catalog.md, in the qa-tester format (action, expected, actual,
 * verdict, evidence for every case; clean-up at the end).
 *
 *   npm run qa:all                          everything that can run on this machine
 *   npm run qa:all -- --headed              watch the browsers
 *   npm run qa:all -- --only=C,V            just some sections
 *   npm run qa:all -- --skip=D              leave some out
 *   npm run qa:all -- --no-ai               skip the steps that call Claude
 *   npm run qa:all -- --local               everything on this machine: the built
 *                                           app on 127.0.0.1 with a mock Shopify
 *                                           Admin API, mock Claude and mock store
 *                                           (needs a local Postgres in DATABASE_URL)
 *
 * Sections, in order: P prerequisites · L local layers (needs DATABASE_URL) ·
 * C live HTTP contract · V visitor pages · S shopper on the storefront ·
 * M merchant in Shopify Admin · B buyer in the portal · D public buyer demo ·
 * A the Shopify side (Shopify Admin's own pages; locally the Admin API log).
 * S, M and B write test data tagged with the run id; nothing is charged.
 *
 * Env (optional): MANNON_LIVE_URL (https://manosh.fly.dev), MANNON_STORE
 * (mannon-9iu9ewku.myshopify.com), MANNON_APP_HANDLE (mannon),
 * MANNON_STOREFRONT_PASSWORD, MANNON_SKUS (two "sku, qty" lines from your store),
 * MANNON_CDP (http://127.0.0.1:9222), DATABASE_URL (for section L),
 * MANNON_MAGIC_LINK (a portal link to use for section B instead of M7's).
 *
 * Output: qa-runs/<run>/REPORT.md, results.json and evidence/ (git-ignored).
 * Exit code 1 when any case FAILs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { Recorder, attachChrome, interactive } from "./lib.mjs";
import { appBridgeStub, startLocalStack } from "./local/stack.mjs";
import { shopifyAdmin } from "./suites/shopify-admin.mjs";
import { contract, local, prerequisites } from "./suites/platform.mjs";
import { visitor } from "./suites/visitor.mjs";
import { merchant } from "./suites/merchant.mjs";
import { buyer, demo } from "./suites/buyer.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const list = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1]?.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) || null;
const ONLY = list("only");
const SKIP = list("skip") || [];
const want = (s) => (!ONLY || ONLY.includes(s)) && !SKIP.includes(s);
const LOCAL = flag("local");
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const RUN = `qa${stamp}`;
const OUT = join(process.cwd(), "qa-runs", RUN);
mkdirSync(OUT, { recursive: true });

const ctx = {
  run: RUN,
  live: (process.env.MANNON_LIVE_URL || "https://manosh.fly.dev").replace(/\/$/, ""),
  store: (process.env.MANNON_STORE || "mannon-9iu9ewku.myshopify.com").replace(/^https?:\/\//, "").replace(/\/$/, ""),
  appHandle: process.env.MANNON_APP_HANDLE || "mannon",
  headed: flag("headed"),
  ai: !flag("no-ai"),
  skus: (process.env.MANNON_SKUS || "sku-untracked-1, 2\nsku-managed-1, 1").replace(/\\n/g, "\n"),
  email: null,
  offerSent: false,
  adminBrowser: null,
  magicLink: process.env.MANNON_MAGIC_LINK || null,
  localStack: null,
  storefront: null,
};
const rec = new Recorder(OUT, RUN);
rec.manual.push(
  "Approving a plan on Shopify's page (M10 stops at the page)",
  "Adding theme blocks (npm run theme:add-blocks) and uninstalling the app",
  "Deleting Shopify draft orders created by B4, D4 and the reorders",
);

console.log(`Mannon full QA · run ${RUN}`);
console.log(LOCAL ? `Local full stack · report ${join(OUT, "REPORT.md")}` : `Live app ${ctx.live} · store ${ctx.store} · report ${join(OUT, "REPORT.md")}`);

/** Local mode: a Chromium standing in for Shopify Admin around the embedded app. */
async function localAdminBrowser() {
  const browser = await chromium.launch({ headless: !ctx.headed });
  const token = ctx.localStack.token();
  const context = await browser.newContext({ userAgent: BROWSER_UA, viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  await context.route(/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js/, (r) => r.fulfill({ contentType: "application/javascript", body: appBridgeStub(token) }));
  await context.route(/^https:\/\/admin\.shopify\.com\//, (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Shopify Admin</title><p>Shopify Admin is not part of the local run.</p>" }));
  return browser;
}

const cleanup = [];
try {
  if (LOCAL) {
    // L first: Vitest truncates the database, the stack seeds it afterwards.
    if (want("L")) await local(rec, ctx);
    rec.begin("P · Local full stack");
    try {
      ctx.localStack = await startLocalStack({ build: flag("build") });
      ctx.live = ctx.localStack.live;
      ctx.store = ctx.localStack.shop;
      ctx.storefront = ctx.localStack.storefront;
      rec.add({ id: "P0", name: "Local full stack starts", action: "build/server on 127.0.0.1:3101, mock Admin API :3103, mock Claude :3104, mock store :3102; migrate + seed", expected: "/healthz answers", status: "PASS", actual: `${ctx.live} · shop ${ctx.store}` });
    } catch (e) {
      rec.add({ id: "P0", name: "Local full stack starts", action: "startLocalStack()", expected: "/healthz answers", status: "FAIL", actual: String(e.message || e) });
      throw e;
    }
    if (want("P")) await prerequisites(rec, ctx);
  } else {
    if (want("P")) await prerequisites(rec, ctx);
    if (want("L")) await local(rec, ctx);
  }
  if (want("C")) await contract(rec, ctx);
  if (want("V")) await visitor(rec, ctx);

  if (want("S")) {
    rec.begin(LOCAL ? "S · Shopper on the (mock) storefront" : "S · Shopper on the live storefront");
    const sdir = join(OUT, "storefront");
    console.log("(the storefront test may ask for the Online Store password)");
    const code = await interactive("node", ["scripts/storefront/storefront-test.mjs", ...(ctx.headed ? ["--headed"] : [])], { env: { MANNON_QA_RUN: RUN, MANNON_QA_OUT: sdir, MANNON_STORE: ctx.storefront || ctx.store, ...(ctx.localStack ? { MANNON_STOREFRONT_PASSWORD: ctx.localStack.storefrontPassword } : {}) } });
    const file = join(sdir, "results.json");
    if (existsSync(file)) {
      const r = JSON.parse(readFileSync(file, "utf8"));
      for (const x of r.results) {
        rec.results.push({ section: rec.section, id: `S·${x.id}`, name: x.name, action: "scripts/storefront/storefront-test.mjs", expected: "see docs/qa/test-catalog.md (S)", status: x.status === "SKIP" ? "SKIP" : x.status, actual: x.detail, evidence: `storefront/` });
      }
      const sent = r.results.filter((x) => ["T1", "T2", "T4"].includes(x.id) && x.status === "PASS").length;
      ctx.email = sent ? r.email : null;
      ctx.offerSent = r.results.some((x) => x.id === "T3" && x.status === "PASS");
      if (sent) rec.created.push(`${sent} storefront quote request(s) from ${r.email}`);
      if (ctx.offerSent) rec.created.push(`1 storefront offer from ${r.email}`);
    } else rec.add({ id: "S0", name: "Storefront test ran", action: "storefront-test.mjs", expected: "results.json", status: "FAIL", actual: `exit ${code}, no results` });
  }

  if (want("M") || want("B")) {
    if (want("M") && LOCAL) {
      ctx.adminBrowser = await localAdminBrowser();
      rec.begin("M · Merchant in the embedded admin (local)");
      rec.add({ id: "M0", name: "Open the embedded app with a session token", action: "embedded=1, shop, host, id_token signed with the app secret; App Bridge stubbed", expected: "pages authenticate like inside Shopify Admin", status: "PASS", actual: "Chromium with a browser user agent (Shopify's library rejects bot agents with 410)" });
      await merchant(rec, ctx);
    } else if (want("M")) {
      const a = await attachChrome();
      if (a.browser) {
        ctx.adminBrowser = a.browser;
        rec.begin("M · Merchant in Shopify Admin");
        rec.add({ id: "M0", name: "Attach to your signed-in Chrome", action: "Chrome DevTools Protocol", expected: "a real Chrome with your Shopify sign-in", status: "PASS", actual: a.url });
        await merchant(rec, ctx);
      } else {
        rec.begin("M · Merchant in Shopify Admin");
        rec.add({ id: "M0", name: "Attach to your signed-in Chrome", action: "Chrome DevTools Protocol", expected: "a real Chrome", status: "BLOCKED", actual: `${a.why}. Quit Chrome running the ~/mannon-chrome profile and run again` });
      }
    }
    if (want("B")) await buyer(rec, ctx);
  }
  if (want("D")) await demo(rec, ctx);
  if (want("A")) {
    if (!LOCAL && !ctx.adminBrowser) { const a = await attachChrome(); if (a.browser) ctx.adminBrowser = a.browser; }
    await shopifyAdmin(rec, ctx);
  }
  if (LOCAL) {
    rec.begin("X · Server health during the run");
    const log = ctx.localStack.serverLog();
    // C13 calls the cron endpoints without the secret on purpose and expects 503.
    const fivexx = log.split("\n").filter((l) => /^(GET|POST|PUT|DELETE|OPTIONS) \S+ 5\d\d /.test(l) && !/^POST \/internal\/cron\/\S+ 503 /.test(l));
    const traces = log.split("\n").filter((l) => /^\s+at .+\(.+:\d+:\d+\)$/.test(l)).length;
    rec.add({ id: "X0", name: "No 5xx response from the app during the run", action: "scan the server's request log", expected: "none", status: fivexx.length ? "FAIL" : "PASS", actual: fivexx.length ? fivexx.slice(0, 5).map((l) => l.replace(/id_token=[^& ]+/, "id_token=…").slice(0, 140)).join(" | ") : `none (${traces} stack-trace lines logged server-side)` });
  }
} catch (e) {
  rec.add({ id: "ERR", name: "Run stopped unexpectedly", action: "—", expected: "—", status: "FAIL", actual: String(e && e.stack ? e.stack.split("\n").slice(0, 2).join(" ") : e) });
} finally {
  if (ctx.adminBrowser) { await ctx.adminBrowser.close().catch(() => {}); cleanup.push(LOCAL ? "Admin browser closed" : "Disconnected from your Chrome (it stays open)"); }
  if (ctx.localStack) {
    writeFileSync(join(OUT, "server.log"), ctx.localStack.serverLog().replace(/id_token=[^&\s]+/g, "id_token=…"));
    writeFileSync(join(OUT, "shopify-calls.json"), JSON.stringify({ shopify: ctx.localStack.shopify.calls, drafts: [...ctx.localStack.shopify.drafts.values()], claude: ctx.localStack.claude.calls }, null, 2));
    await ctx.localStack.stop();
    cleanup.push("Local app, mock Admin API, mock Claude and mock store stopped (logs: server.log, shopify-calls.json)");
  }
  cleanup.push("Every test browser closed");
  cleanup.push(want("L") && process.env.DATABASE_URL ? "Local smoke server tmux session killed by qa-smoke.sh (see L4)" : "No tmux session was started");
}

rec.write({ Run: RUN, Mode: LOCAL ? "local full stack (mock Shopify Admin API, mock Claude, mock storefront)" : "live", "Live app": ctx.live, Store: ctx.store, Code: ctx.commit || "not read", Node: process.version, Sections: ONLY ? ONLY.join(",") : `all${SKIP.length ? ` except ${SKIP.join(",")}` : ""}`, "Claude steps": ctx.ai ? "on" : "off" }, cleanup);
const c = rec.counts();
console.log(`\nTotal ${rec.results.length} · PASS ${c.PASS || 0} · FAIL ${c.FAIL || 0} · BLOCKED ${c.BLOCKED || 0} · SKIP ${c.SKIP || 0} · INFO ${c.INFO || 0}`);
console.log(`Report: ${join(OUT, "REPORT.md")}`);
if (rec.created.length) console.log(`Created by this run (tag ${RUN}):\n- ${rec.created.join("\n- ")}`);
process.exit(c.FAIL ? 1 : 0);
