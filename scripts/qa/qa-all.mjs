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
 *
 * Sections, in order: P prerequisites · L local layers (needs DATABASE_URL) ·
 * C live HTTP contract · V visitor pages · S shopper on the storefront ·
 * M merchant in Shopify Admin · B buyer in the portal · D public buyer demo.
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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Recorder, attachChrome, interactive } from "./lib.mjs";
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
};
const rec = new Recorder(OUT, RUN);
rec.manual.push(
  "Approving a plan on Shopify's page (M10 stops at the page)",
  "Adding theme blocks (npm run theme:add-blocks) and uninstalling the app",
  "Deleting Shopify draft orders created by B4, D4 and the reorders",
);

console.log(`Mannon full QA · run ${RUN}`);
console.log(`Live app ${ctx.live} · store ${ctx.store} · report ${join(OUT, "REPORT.md")}`);

const cleanup = [];
try {
  if (want("P")) await prerequisites(rec, ctx);
  if (want("L")) await local(rec, ctx);
  if (want("C")) await contract(rec, ctx);
  if (want("V")) await visitor(rec, ctx);

  if (want("S")) {
    rec.begin("S · Shopper on the live storefront");
    const sdir = join(OUT, "storefront");
    console.log("(the storefront test may ask for the Online Store password)");
    const code = await interactive("node", ["scripts/storefront/storefront-test.mjs", ...(ctx.headed ? ["--headed"] : [])], { env: { MANNON_QA_RUN: RUN, MANNON_QA_OUT: sdir, MANNON_STORE: ctx.store } });
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
    if (want("M")) {
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
} catch (e) {
  rec.add({ id: "ERR", name: "Run stopped unexpectedly", action: "—", expected: "—", status: "FAIL", actual: String(e && e.stack ? e.stack.split("\n").slice(0, 2).join(" ") : e) });
} finally {
  if (ctx.adminBrowser) { await ctx.adminBrowser.close().catch(() => {}); cleanup.push("Disconnected from your Chrome (it stays open)"); }
  cleanup.push("Every test browser closed");
  cleanup.push(want("L") && process.env.DATABASE_URL ? "Local smoke server tmux session killed by qa-smoke.sh (see L4)" : "No tmux session was started");
}

rec.write({ Run: RUN, "Live app": ctx.live, Store: ctx.store, Code: ctx.commit || "not read", Node: process.version, Sections: ONLY ? ONLY.join(",") : `all${SKIP.length ? ` except ${SKIP.join(",")}` : ""}`, "Claude steps": ctx.ai ? "on" : "off" }, cleanup);
const c = rec.counts();
console.log(`\nTotal ${rec.results.length} · PASS ${c.PASS || 0} · FAIL ${c.FAIL || 0} · BLOCKED ${c.BLOCKED || 0} · SKIP ${c.SKIP || 0} · INFO ${c.INFO || 0}`);
console.log(`Report: ${join(OUT, "REPORT.md")}`);
if (rec.created.length) console.log(`Created by this run (tag ${RUN}):\n- ${rec.created.join("\n- ")}`);
process.exit(c.FAIL ? 1 : 0);
