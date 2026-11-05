/*
 * The local full stack for `npm run qa:all -- --local`: a production build of
 * Mannon served on 127.0.0.1, wired to a mock Shopify Admin API, a mock Claude
 * and a mock Online Store, on a local Postgres (DATABASE_URL). Every flow,
 * including the embedded admin pages, then runs without a real store.
 *
 * The admin pages are opened the way Shopify opens them: with `embedded=1`,
 * `shop`, `host` and a session token signed with SHOPIFY_API_SECRET, and the
 * App Bridge script replaced by a small stub (there is no Shopify Admin around
 * the page). Production flags come from fly.toml's [env], so the local app has
 * the same features switched on as manosh.fly.dev.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createMockShopify } from "./mock-shopify.mjs";
import { createMockClaude } from "./mock-claude.mjs";
import { createMockStorefront, MOCK_STOREFRONT_PASSWORD } from "./mock-storefront.mjs";

const ROOT = process.cwd();
export const LOCAL_SHOP = "mannon-dev.myshopify.com";

function flyEnv() {
  const toml = readFileSync(join(ROOT, "fly.toml"), "utf8");
  const block = (toml.split(/^\[env\]\s*$/m)[1] || "").split(/^\[/m)[0];
  return Object.fromEntries([...block.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
}
const scopes = () => (readFileSync(join(ROOT, "shopify.app.toml"), "utf8").match(/^scopes\s*=\s*"([^"]*)"/m) || [])[1] || "";
const listen = (server, port) => new Promise((r, j) => { server.once("error", j); server.listen(port, "127.0.0.1", r); });
const b64url = (b) => Buffer.from(b).toString("base64url");

/** A Shopify session token (HS256, signed with the app secret), as App Bridge would send. */
export function sessionToken({ shop, apiKey, secret }) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: `https://${shop}/admin`, dest: `https://${shop}`, aud: apiKey, sub: "1", exp: now + 3600, nbf: now - 10, iat: now - 10, jti: randomUUID(), sid: randomUUID() }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** App Bridge stand-in: `window.shopify` with idToken() and quiet no-ops for the rest. */
export function appBridgeStub(token) {
  return `(() => {
  const calls = (window.__mannonAppBridge = []);
  const noop = (path) => new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? undefined : noop(path + "." + String(k))),
    apply: (_t, _s, args) => { calls.push({ path, args: JSON.stringify(args).slice(0, 300) }); return Promise.resolve(undefined); },
  });
  const shopify = noop("shopify");
  window.shopify = new Proxy(shopify, { get: (t, k) => (k === "idToken" ? async () => ${JSON.stringify(token)} : k === "config" ? { shop: ${JSON.stringify(LOCAL_SHOP)}, apiKey: "e2e-key" } : t[k]) });
  // App Bridge's web components (save bar, modal, title bar, nav menu): the real
  // script defines them with show()/hide()/toggle(); here they are quiet no-ops.
  for (const tag of ["ui-save-bar", "ui-modal", "ui-title-bar", "ui-nav-menu"]) {
    if (customElements.get(tag)) continue;
    customElements.define(tag, class extends HTMLElement {
      show() { calls.push({ path: tag + ".show", args: "" }); return Promise.resolve(); }
      hide() { calls.push({ path: tag + ".hide", args: "" }); return Promise.resolve(); }
      toggle() { return Promise.resolve(); }
      get showing() { return false; }
    });
  }
  const open = window.open;
  window.open = (url, target) => { calls.push({ path: "window.open", args: JSON.stringify([url, target]) }); return target === "_top" ? null : open.call(window, url, target); };
})();`;
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" ")}`);
  return r.stdout;
}

export async function startLocalStack({ port = 3101, storePort = 3102, shopifyPort = 3103, claudePort = 3104, build = false, log = console.log } = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (a local Postgres for the run)");
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL)) throw new Error("DATABASE_URL must point at a local database for --local");
  const apiKey = process.env.SHOPIFY_API_KEY || "e2e-key";
  const secret = process.env.SHOPIFY_API_SECRET || "e2e-secret";
  const live = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    ...flyEnv(),
    NODE_ENV: "production",
    PORT: String(port),
    SHOPIFY_API_KEY: apiKey,
    SHOPIFY_API_SECRET: secret,
    SHOPIFY_APP_URL: live,
    SCOPES: scopes(),
    SESSION_SECRET: process.env.SESSION_SECRET || "local-qa-session-secret-0123456789abcdef",
    MANNON_DEMO_SHOP: LOCAL_SHOP,
    ANTHROPIC_API_KEY: "sk-ant-local-mock-not-a-key",
    MANNON_QA_SHOPIFY_MOCK: `http://127.0.0.1:${shopifyPort}`,
    MANNON_QA_ANTHROPIC_MOCK: `http://127.0.0.1:${claudePort}`,
    // The Anthropic SDK reads its base URL from the environment (it does not use globalThis.fetch).
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${claudePort}`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import ${new URL("./preload.mjs", import.meta.url).href}`.trim(),
  };
  delete env.SENTRY_DSN;
  delete env.POSTHOG_API_KEY;

  if (build || !existsSync(join(ROOT, "build/server/index.js"))) { log("building the app (npm run build)…"); run("npm", ["run", "build"], { ...process.env }); }
  log("preparing the local database (migrate, seed, fixtures)…");
  run("npx", ["prisma", "migrate", "deploy"], env);
  run("npx", ["tsx", "prisma/seed.ts"], env);
  const fx = JSON.parse(run("npx", ["tsx", "scripts/qa/local/fixtures.mts"], env).trim().split("\n").pop());

  const shopify = createMockShopify();
  const claude = createMockClaude();
  const store = createMockStorefront({ shop: LOCAL_SHOP, appUrl: live });
  await listen(shopify.server, shopifyPort);
  await listen(claude.server, claudePort);
  await listen(store, storePort);

  const out = [];
  const child = spawn(process.execPath, ["node_modules/@remix-run/serve/dist/cli.js", "./build/server/index.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => out.push(String(d)));
  child.stderr.on("data", (d) => out.push(String(d)));
  const t0 = Date.now();
  let up = false;
  while (!up && Date.now() - t0 < 60000) {
    if (child.exitCode != null) break;
    try { up = (await fetch(`${live}/healthz`)).status < 500; } catch { /* starting */ }
    if (!up) await new Promise((r) => setTimeout(r, 400));
  }
  if (!up) { child.kill(); throw new Error(`the app did not start: ${out.join("").slice(-600)}`); }
  log(`local stack up: app ${live} · storefront http://127.0.0.1:${storePort} · mock Shopify :${shopifyPort} · mock Claude :${claudePort}`);

  return {
    live,
    shop: LOCAL_SHOP,
    buyerId: fx.buyerId,
    storefront: `127.0.0.1:${storePort}`,
    storefrontPassword: MOCK_STOREFRONT_PASSWORD,
    shopify,
    claude,
    serverLog: () => out.join(""),
    token: () => sessionToken({ shop: LOCAL_SHOP, apiKey, secret }),
    env,
    async stop() {
      child.kill();
      await Promise.all([shopify.server, claude.server, store].map((s) => new Promise((r) => s.close(() => r()))));
    },
  };
}
