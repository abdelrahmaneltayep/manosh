/*
 * P — prerequisites, L — local layers (tmux smoke, unit, e2e), C — the live
 * HTTP contract. No browser, no secrets: nothing here changes data.
 */
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { capture, tail } from "../lib.mjs";

const timed = async (url, init = {}) => {
  const t0 = performance.now();
  const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000), ...init });
  const ms = performance.now() - t0;
  const body = await r.text().catch(() => "");
  return { r, body, ms };
};
const LEAK = /at [A-Za-z_$.]+ \(.*:\d+:\d+\)|node_modules\/|SHOPIFY_API_SECRET|ANTHROPIC_API_KEY|SESSION_SECRET|DATABASE_URL=/;

export async function prerequisites(rec, ctx) {
  rec.begin("P · Prerequisites");
  await rec.tc("P1", "Node version", { action: "node --version", expected: "Node ≥ 20.19 or ≥ 22.12" }, async () => {
    const [maj, min] = process.versions.node.split(".").map(Number);
    const ok = (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || maj > 22;
    return { status: ok ? "PASS" : "FAIL", actual: `v${process.versions.node}` };
  });
  await rec.tc("P2", "Playwright Chromium launches", { action: "chromium.launch()", expected: "a browser starts" }, async () => {
    const b = await chromium.launch();
    const v = b.version();
    await b.close();
    return { actual: `Chromium ${v}` };
  });
  await rec.tc("P3", "Live app answers /healthz", { action: `GET ${ctx.live}/healthz`, expected: "200 or 503 with configOk" }, async () => {
    const { r, body } = await timed(`${ctx.live}/healthz`);
    if (![200, 503].includes(r.status) || !/configOk/.test(body)) throw new Error(`HTTP ${r.status}: ${body.slice(0, 120)}`);
    return { actual: `HTTP ${r.status} ${body.slice(0, 120)}` };
  });
  await rec.tc("P4", "Code under test recorded", { action: "git rev-parse", expected: "branch and commit named" }, async () => {
    const b = await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    const c = await capture("git", ["rev-parse", "--short", "HEAD"]);
    ctx.commit = `${b.out.trim()} @ ${c.out.trim()}`;
    return { status: "INFO", actual: `${ctx.commit} (the live app runs whatever you last deployed with fly deploy)` };
  });
}

export async function local(rec, ctx) {
  rec.begin("L · Local layers");
  if (!process.env.DATABASE_URL) {
    for (const [id, name] of [["L1", "Typecheck"], ["L2", "Unit and integration tests"], ["L3", "End-to-end tests on the served build"], ["L4", "HTTP contract smoke in tmux"]]) {
      rec.skip(id, name, { action: "needs a local Postgres", expected: "—" }, "DATABASE_URL is not set on this machine; these run in CI and in the cloud session. Set DATABASE_URL (and run npx prisma migrate deploy) to include them");
    }
    return;
  }
  await rec.tc("L1", "Typecheck", { action: "npx tsc --noEmit", expected: "exit 0" }, async () => {
    const r = await capture("npx", ["tsc", "--noEmit"]);
    const ev = rec.text("typecheck", r.out);
    if (r.code !== 0) throw Object.assign(new Error(tail(r.out, 3)), { ev });
    return { actual: "no type errors", evidence: ev };
  });
  await rec.tc("L2", "Unit and integration tests", { action: "npx vitest run", expected: "every file passes" }, async () => {
    const r = await capture("npx", ["vitest", "run"]);
    const ev = rec.text("vitest", r.out);
    const sum = (r.out.match(/Test Files .*\n.*Tests .*/) || [""])[0].replace(/\s+/g, " ");
    if (r.code !== 0) throw new Error(`${sum || tail(r.out, 3)} (see ${ev})`);
    return { actual: sum, evidence: ev };
  });
  await rec.tc("L3", "End-to-end tests on the served build", { action: "npm run test:e2e", expected: "every test passes" }, async () => {
    const r = await capture("npm", ["run", "test:e2e"], { env: { SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY || "qa-key", SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET || "qa-secret", SESSION_SECRET: process.env.SESSION_SECRET || "qa-session-secret-0123456789" } });
    const ev = rec.text("e2e", r.out);
    const sum = (r.out.match(/Test Files .*\n.*Tests .*/) || [""])[0].replace(/\s+/g, " ");
    if (r.code !== 0) throw new Error(`${sum || tail(r.out, 3)} (see ${ev})`);
    return { actual: sum, evidence: ev };
  });
  await rec.tc("L4", "HTTP contract smoke in tmux", { action: "bash scripts/qa-smoke.sh (server in a tmux session)", expected: "0 failures, 0 server errors, session killed" }, async () => {
    for (const bin of ["tmux", "nc", "jq", "openssl"]) {
      const w = await capture("sh", ["-c", `command -v ${bin}`]);
      if (w.code !== 0) return { status: "SKIP", actual: `${bin} is not installed (brew install ${bin === "nc" ? "netcat" : bin})` };
    }
    const r = await capture("bash", ["scripts/qa-smoke.sh"], { env: { QA_OUT: `${rec.evidence}/smoke`, QA_PORT: process.env.QA_PORT || "3190" } });
    const ev = rec.text("qa-smoke", r.out);
    const total = (r.out.match(/TOTAL .*/) || [""])[0];
    if (r.code !== 0 || !/FAIL 0 SERVER_ERRORS 0/.test(total)) throw new Error(`${total || tail(r.out, 3)} (see ${ev})`);
    return { actual: `${total}; ${(r.out.match(/session killed: .*/) || ["session state unknown"])[0]}`, evidence: ev };
  });
}

export async function contract(rec, ctx) {
  rec.begin("C · Live HTTP contract");
  const L = ctx.live;
  const page = async (id, name, path, { status = /^200$/, must, mustNot } = {}) =>
    rec.tc(id, name, { action: `GET ${L}${path}`, expected: `HTTP ${status.source.replace(/[\^$]/g, "")}${must ? `, contains ${must}` : ""}` }, async () => {
      const { r, body } = await timed(L + path);
      if (!status.test(String(r.status))) throw new Error(`HTTP ${r.status}`);
      if (must && !must.test(body)) throw new Error(`missing ${must}`);
      if (mustNot && mustNot.test(body)) throw new Error(`found ${mustNot}`);
      if (LEAK.test(body)) throw new Error("a stack trace or secret name leaked");
      return { actual: `HTTP ${r.status}${r.headers.get("location") ? ` → ${r.headers.get("location")}` : ""}` };
    });

  await page("C1", "Home", "/", { must: /buyer.s first click/ });
  await rec.tc("C2", "?shop= hands off to the embedded app", { action: `GET ${L}/?shop=example.myshopify.com`, expected: "30x to /app?shop=" }, async () => {
    const { r } = await timed(`${L}/?shop=example.myshopify.com`);
    const loc = r.headers.get("location") || "";
    if (!/^30[1278]$/.test(String(r.status)) || !/\/app\?shop=/.test(loc)) throw new Error(`HTTP ${r.status} → ${loc || "no redirect"}`);
    return { actual: `HTTP ${r.status} → ${loc}` };
  });
  await page("C3", "Pricing: the v3 ladder", "/pricing", { must: /Scale/, mustNot: /\$79/ });
  await page("C4", "Demo store page", "/demo/store", { must: /Harbor Blend Espresso/ });
  await page("C5a", "Demo hub", "/demo", { must: /See the whole workflow/ });
  await page("C5b", "Merchant tour", "/demo/tour", { must: /tour-step/ });
  await page("C5c", "Privacy policy", "/privacy", { must: /Privacy Policy/ });
  await page("C6", "Unknown URL is a friendly 404", "/qa-no-such-page", { status: /^404$/, must: /Page not found|page you/i, mustNot: /TypeError|ReferenceError/ });
  await page("C16", "Discovery directory is off for the App Store review (1.1.6)", "/discover", { status: /^404$/, mustNot: /Discover wholesale/ });
  for (const [id, path, type] of [["C7a", "/favicon.ico", /icon/], ["C7b", "/favicon-32.png", /png/], ["C7c", "/apple-touch-icon.png", /png/]]) {
    await rec.tc(id, `Icon ${path}`, { action: `GET ${L}${path}`, expected: "200 with an image type" }, async () => {
      const { r } = await timed(L + path);
      const ct = r.headers.get("content-type") || "";
      if (r.status !== 200 || !type.test(ct)) throw new Error(`HTTP ${r.status} ${ct}`);
      return { actual: `HTTP 200 ${ct}` };
    });
  }

  const body = JSON.stringify({ shop_domain: "example.myshopify.com", customer: { email: "qa@example.test" }, orders_requested: [] });
  for (const topic of ["customers/data_request", "customers/redact", "shop/redact", "app/uninstalled"]) {
    for (const [label, sig] of [["unsigned", null], ["wrong signature", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="]]) {
      await rec.tc(`C8`, `Webhook ${topic} ${label} → 401`, { action: `POST ${L}/webhooks/${topic} (${label})`, expected: "401 before any handler runs" }, async () => {
        const headers = { "content-type": "application/json", "x-shopify-topic": topic, "x-shopify-shop-domain": "example.myshopify.com" };
        if (sig) headers["x-shopify-hmac-sha256"] = sig;
        const { r } = await timed(`${L}/webhooks/${topic}`, { method: "POST", headers, body });
        if (r.status !== 401) throw new Error(`HTTP ${r.status}`);
        return { actual: "HTTP 401" };
      });
    }
  }
  if (process.env.SHOPIFY_API_SECRET) {
    await rec.tc("C8s", "Webhook shop/redact correctly signed → 200", { action: `POST ${L}/webhooks/shop/redact (signed with SHOPIFY_API_SECRET)`, expected: "200, unknown shop handled" }, async () => {
      const hmac = createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(body).digest("base64");
      const { r } = await timed(`${L}/webhooks/shop/redact`, { method: "POST", headers: { "content-type": "application/json", "x-shopify-topic": "shop/redact", "x-shopify-shop-domain": "example.myshopify.com", "x-shopify-hmac-sha256": hmac }, body });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      return { actual: "HTTP 200" };
    });
  }

  for (const ep of ["quote-widget-config", "quote-capture-config", "offer-config"]) {
    await rec.tc("C9", `/api/${ep} for an unknown shop`, { action: `GET ${L}/api/${ep}?shop=example.myshopify.com`, expected: "{enabled:false} with CORS" }, async () => {
      const { r, body: b } = await timed(`${L}/api/${ep}?shop=example.myshopify.com`);
      if (r.status !== 200 || !/"enabled":false/.test(b) || r.headers.get("access-control-allow-origin") !== "*") throw new Error(`HTTP ${r.status} ${b.slice(0, 80)} CORS=${r.headers.get("access-control-allow-origin")}`);
      return { actual: `HTTP 200 ${b.slice(0, 60)}` };
    });
  }
  for (const ep of ["quote-request", "offer"]) {
    await rec.tc("C10", `Preflight OPTIONS /api/${ep}`, { action: `OPTIONS ${L}/api/${ep}`, expected: "204 with CORS" }, async () => {
      const { r } = await timed(`${L}/api/${ep}`, { method: "OPTIONS", headers: { origin: "https://example.myshopify.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
      if (r.status !== 204 || !r.headers.get("access-control-allow-origin")) throw new Error(`HTTP ${r.status}`);
      return { actual: "HTTP 204 with CORS" };
    });
    await rec.tc("C11", `POST /api/${ep} with an empty body`, { action: `POST ${L}/api/${ep} {}`, expected: "400 JSON, never 5xx" }, async () => {
      const { r, body: b } = await timed(`${L}/api/${ep}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.status !== 400 || !/"ok":false/.test(b)) throw new Error(`HTTP ${r.status} ${b.slice(0, 80)}`);
      return { actual: `HTTP 400 ${b.slice(0, 60)}` };
    });
  }
  await page("C12a", "Portal without a session", "/portal", { status: /^(200|30[1278])$/ });
  await page("C12b", "Magic link with a bad token", "/portal/auth?token=not-a-real-token", { status: /^(200|40[01])$/, must: /expired|invalid|sign in|link/i });
  for (const job of ["followups", "reminders", "payment-reminders"]) {
    await rec.tc("C13", `Cron ${job} without the secret`, { action: `POST ${L}/internal/cron/${job}`, expected: "401/503, or 200 'skipped' when the feature is off; never runs" }, async () => {
      const { r, body: b } = await timed(`${L}/internal/cron/${job}`, { method: "POST" });
      if (r.status === 200 && /"skipped"/.test(b) && !/"sent":[1-9]/.test(b)) return { actual: `HTTP 200 ${b.slice(0, 60)}` };
      if (!/^(401|403|404|405|503)$/.test(String(r.status))) throw new Error(`HTTP ${r.status} ${b.slice(0, 80)}`);
      return { actual: `HTTP ${r.status}` };
    });
  }
  for (const path of ["/", "/pricing", "/api/quote-widget-config?shop=example.myshopify.com"]) {
    await rec.tc("C15", `p95 latency ${path}`, { action: `1 warm-up + 20 × GET ${L}${path}`, expected: "p95 < 500 ms (definition of done)" }, async () => {
      // One untimed warm-up (TLS handshake, a machine just woken by a deploy),
      // then 20 timed requests, so p95 isn't simply the single slowest sample.
      await timed(L + path);
      const ms = [];
      for (let i = 0; i < 20; i++) ms.push((await timed(L + path)).ms);
      ms.sort((a, b) => a - b);
      const p95 = ms[Math.ceil(0.95 * ms.length) - 1];
      const median = ms[Math.floor(ms.length / 2)];
      return { status: p95 < 500 ? "PASS" : "FAIL", actual: `p95 ${p95.toFixed(0)} ms, median ${median.toFixed(0)} ms, slowest ${ms[ms.length - 1].toFixed(0)} ms (includes your network)` };
    });
  }
  if (!existsSync("build/server/index.js")) ctx.noBuild = true;
}
