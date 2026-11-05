/*
 * Shared core for the full QA run (scripts/qa/qa-all.mjs), in the qa-tester
 * style: every case records the action, the expected result, the actual result,
 * a verdict and its evidence, and the run always cleans up after itself.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MARK = { PASS: "PASS", FAIL: "FAIL", BLOCKED: "BLKD", SKIP: "SKIP", INFO: "INFO" };

export class Recorder {
  constructor(outDir, run) {
    this.out = outDir;
    this.run = run;
    this.evidence = join(outDir, "evidence");
    mkdirSync(this.evidence, { recursive: true });
    this.results = [];
    this.section = null;
    this.created = []; // artifacts this run created (for the clean-up list)
    this.manual = [];
    this.n = 0;
  }

  begin(section) {
    this.section = section;
    console.log(`\n── ${section} ${"─".repeat(Math.max(4, 70 - section.length))}`);
  }

  add({ id, name, action, expected, status, actual, evidence }) {
    const r = { section: this.section, id, name, action, expected, status, actual: String(actual ?? ""), evidence: evidence ?? null };
    this.results.push(r);
    const line = `${id.padEnd(5)} ${MARK[status].padEnd(4)} ${name}${r.actual ? `  —  ${r.actual.replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
    console.log(line);
    return r;
  }

  /**
   * Run one case. `fn` returns { status?, actual, evidence? } (status defaults to
   * PASS) or throws (FAIL with the error message). `onFail` may return evidence.
   */
  async tc(id, name, { action, expected }, fn, onFail) {
    try {
      const res = (await fn()) || {};
      return this.add({ id, name, action, expected, status: res.status || "PASS", actual: res.actual, evidence: res.evidence });
    } catch (e) {
      let evidence = null;
      try { evidence = onFail ? await onFail() : null; } catch { /* best effort */ }
      return this.add({ id, name, action, expected, status: "FAIL", actual: String(e && e.message ? e.message : e).split("\n")[0], evidence });
    }
  }

  blocked(id, name, { action, expected }, why) {
    return this.add({ id, name, action, expected, status: "BLOCKED", actual: why });
  }
  skip(id, name, { action, expected }, why) {
    return this.add({ id, name, action, expected, status: "SKIP", actual: why });
  }

  /** Screenshot as evidence; returns the path relative to the report. */
  async shot(page, name) {
    this.n += 1;
    const file = join(this.evidence, `${String(this.n).padStart(3, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.png`);
    try { await page.screenshot({ path: file }); } catch { return null; }
    return relative(this.out, file);
  }

  /** Save captured text output as evidence. */
  text(name, content) {
    this.n += 1;
    const file = join(this.evidence, `${String(this.n).padStart(3, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}.txt`);
    writeFileSync(file, content);
    return relative(this.out, file);
  }

  counts() {
    return this.results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  }

  write(env, cleanup) {
    const c = this.counts();
    const lines = [
      `## QA Test Report: Mannon, all flows — ${this.run}`,
      "",
      "### Environment",
      ...Object.entries(env).map(([k, v]) => `- ${k}: ${v}`),
      "",
      "### Summary",
      `- Total: ${this.results.length} cases`,
      `- Passed: ${c.PASS || 0} · Failed: ${c.FAIL || 0} · Blocked: ${c.BLOCKED || 0} · Skipped: ${c.SKIP || 0} · Info: ${c.INFO || 0}`,
      "",
      "| Section | ID | Case | Status |",
      "|---|---|---|---|",
      ...this.results.map((r) => `| ${r.section} | ${r.id} | ${r.name} | ${r.status} |`),
      "",
      "### Test Cases",
    ];
    let sec = null;
    for (const r of this.results) {
      if (r.section !== sec) { sec = r.section; lines.push("", `### ${sec}`); }
      lines.push(
        "",
        `#### ${r.id}: ${r.name}`,
        `- **Command / action**: ${r.action}`,
        `- **Expected**: ${r.expected}`,
        `- **Actual**: ${r.actual || "—"}`,
        `- **Status**: ${r.status}`,
        ...(r.evidence ? [`- **Evidence**: ${r.evidence}`] : []),
      );
    }
    lines.push("", "### Created by this run", ...(this.created.length ? this.created.map((x) => `- ${x}`) : ["- nothing"]));
    lines.push("", "### Manual (not automated on purpose)", ...this.manual.map((x) => `- ${x}`));
    lines.push("", "### Cleanup", ...cleanup.map((x) => `- ${x}`));
    writeFileSync(join(this.out, "REPORT.md"), lines.join("\n") + "\n");
    writeFileSync(join(this.out, "results.json"), JSON.stringify({ run: this.run, env, counts: c, results: this.results, created: this.created }, null, 2));
  }
}

/** Run a command, stream nothing, keep the output; resolves { code, out }. */
export function capture(cmd, args, { cwd, env, timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const add = (b) => { out += b.toString(); if (out.length > 4_000_000) out = out.slice(-2_000_000); };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => { child.kill("SIGTERM"); out += `\n[killed after ${timeoutMs / 1000}s]`; }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 127, out: String(e) }); });
  });
}

/** Run a command with the terminal attached (for steps that may prompt). */
export function interactive(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(127));
  });
}

export const tail = (s, n = 25) => s.trim().split("\n").slice(-n).join("\n");

// --- the merchant's signed-in Chrome -----------------------------------------

async function cdpInfo(url) {
  try {
    const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
const isChrome = (v) => Boolean(v) && /Chrome|Chromium/.test(v.Browser || "") && !/Electron/i.test(v["User-Agent"] || "");

async function startChrome(port) {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform !== "darwin" || !existsSync(chrome)) return false;
  console.log(`Starting your Chrome (profile ~/mannon-chrome, port ${port}) for the admin steps…`);
  spawn(chrome, [`--user-data-dir=${join(homedir(), "mannon-chrome")}`, `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 30; i++) { if (isChrome(await cdpInfo(`http://127.0.0.1:${port}`))) return true; await sleep(500); }
  return false;
}

/** Attach to a real Chrome (not an Electron app on the port). */
export async function attachChrome(cdp = process.env.MANNON_CDP || "http://127.0.0.1:9222") {
  const first = await cdpInfo(cdp);
  const tried = [];
  const candidates = [];
  if (isChrome(first)) candidates.push(cdp);
  else if (first) tried.push(`${cdp} is ${/Electron/i.test(first["User-Agent"] || "") ? "an Electron app" : first.Browser || "not Chrome"}`);
  const own = "http://127.0.0.1:9333";
  if (!candidates.length && (isChrome(await cdpInfo(own)) || (await startChrome(9333)))) candidates.push(own);
  if (!candidates.length && !first && (await startChrome(9222))) candidates.push(cdp);
  for (const url of candidates) {
    try { return { browser: await chromium.connectOverCDP(url), url }; }
    catch (e) { tried.push(`${url}: ${String(e.message || e).split("\n")[0]}`); }
  }
  return { browser: null, why: tried.length ? tried.join("; ") : "no Chrome could be started" };
}

export const ERROR_TEXT = /Something went wrong|Application error|Unexpected Server Error|There['’]s no page at this address|We hit an unexpected problem/i;

/** Open a page of the embedded app; returns the app frame (waits for sign-in). */
export async function openApp(page, { store, appHandle, appHost }, path) {
  const handle = store.replace(/\.myshopify\.com$/, "");
  const url = `https://admin.shopify.com/store/${handle}/apps/${appHandle}${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (/accounts\.shopify\.com|\/login/.test(page.url())) {
    console.log("Sign in to Shopify in the Chrome window; waiting up to 5 minutes…");
    await page.waitForURL(/admin\.shopify\.com\/store\//, { timeout: 300000 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  const t0 = Date.now();
  let frame = null;
  while (!frame && Date.now() - t0 < 40000) { frame = page.frames().find((f) => f.url().includes(appHost)); if (!frame) await sleep(400); }
  if (!frame) throw new Error(`the app frame for ${path} never loaded`);
  await frame.waitForLoadState("domcontentloaded").catch(() => {});
  await frame.locator("body").waitFor({ timeout: 20000 });
  await sleep(1500);
  return frame;
}

export async function textOf(frameOrPage) {
  return ((await frameOrPage.locator("body").innerText({ timeout: 10000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
}

/** Pick the payment-terms option whose label mentions Net 30 (or the first Net option). */
export async function pickNet30(p) {
  const sel = p.locator("select[name=paymentTermsTemplateId]").first();
  if (!(await sel.count())) return "no terms selector";
  const labels = await sel.locator("option").allTextContents();
  let i = labels.findIndex((l) => /net\s*30|30 days/i.test(l));
  if (i < 0) i = labels.findIndex((l) => /net/i.test(l));
  if (i < 0) return `no Net option (${labels.join(", ")})`;
  await sel.selectOption({ index: i });
  return labels[i].trim();
}
