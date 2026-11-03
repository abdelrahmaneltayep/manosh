// Records the 16 walkthrough scenes as separate 1920x1080 clips with Playwright,
// driving the real Google Chrome so the Shopify admin sign-in persists.
//
//   node scripts/video/record.mjs            all scenes
//   node scripts/video/record.mjs 5 6 7      only those scenes
//
// Admin scenes run in a persistent Chrome profile (~/mannon-chrome). On the
// first run the script opens the admin and waits for a person to sign in; it
// never types credentials. Buyer scenes run in a fresh private context.
//
// Every click is best-effort: if a control is not found the script says so and
// keeps recording for the scene's slot, so a person can take over in the
// headed window. Nothing here is a test; it is a camera with a chauffeur.
//
// Two ways to get a signed-in admin:
//   default           Playwright launches Chrome on the ~/mannon-chrome profile.
//   MANNON_VIDEO_CDP  e.g. http://127.0.0.1:9222: attach to a Chrome a person
//                     started themselves (so Google sign-in works there), and film
//                     each scene through Chrome's own screencast instead of
//                     Playwright's recorder. The shell wrapper's `record --cdp`
//                     starts that Chrome for you.
//
// Environment (all optional):
//   MANNON_VIDEO_PRODUCT_URL  a live product page with the Mannon blocks (scene 14a)
//   MANNON_VIDEO_BUYER        text that identifies the buyer row on Buyers (scene 8)
//   MANNON_VIDEO_SKUS         two lines for the order pad, e.g. "20x sku-a\n5x sku-b"

import { chromium } from "playwright";
import { readFileSync, mkdirSync, renameSync, existsSync, writeFileSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..", "..");
const cfg = JSON.parse(readFileSync(path.join(here, "scenes.json"), "utf8"));
const RAW = path.join(repo, "docs", "video", "menna", "raw");
const PROFILE = path.join(homedir(), "mannon-chrome");
const SIZE = { width: 1920, height: 1080 };
const EXTRA_S = 2;

const ADMIN = `https://admin.shopify.com/store/${cfg.store}`;
const APP = `${ADMIN}/apps/${cfg.appHandle}/app`;
const only = new Set(process.argv.slice(2).map(Number).filter(Boolean));
const want = (n) => only.size === 0 || only.has(n);

mkdirSync(RAW, { recursive: true });
const state = { quoteUrl: null, magicLink: null, buyerEmail: null };
const COMPANY = process.env.MANNON_VIDEO_COMPANY || cfg.demoCompany || "";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryStep(name, fn, timeout = 15000, page = null) {
  try {
    await Promise.race([fn(), sleep(timeout).then(() => { throw new Error("timed out"); })]);
    log(`  ✓ ${name}`);
  } catch (e) {
    log(`  ! ${name}: ${e.message}. Take over in the Chrome window if needed.`);
    if (page) {
      try {
        const alert = await page.locator("[role=alert], .error, .Polaris-Banner--statusCritical").first().textContent({ timeout: 1000 });
        if (alert?.trim()) log(`    page says: ${alert.trim().slice(0, 300)}`);
      } catch {}
    }
  }
}

/** The embedded app's frame inside the Shopify admin page. */
async function appFrame(page) {
  for (let i = 0; i < 60; i++) {
    const f = page.frames().find((fr) => fr.url().includes(cfg.appHost));
    if (f) return f;
    await sleep(500);
  }
  throw new Error("app frame not found");
}

async function waitForSignIn(page) {
  await page.goto(APP);
  for (let i = 0; i < 1200; i++) {
    if (page.url().includes(`/apps/${cfg.appHandle}`) && page.frames().some((f) => f.url().includes(cfg.appHost))) return;
    if (i % 20 === 0) log("Waiting for a Shopify sign-in in the Chrome window (admin scenes need it)…");
    await sleep(500);
  }
  throw new Error("no Shopify sign-in after 10 minutes");
}

const CDP = process.env.MANNON_VIDEO_CDP || null;

function ffmpegBin() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return "ffmpeg"; } catch {}
  const cache = path.join(homedir(), "Library", "Caches", "ms-playwright");
  if (existsSync(cache)) {
    const dir = readdirSync(cache).find((d) => d.startsWith("ffmpeg"));
    if (dir) return path.join(cache, dir, "ffmpeg-mac");
  }
  throw new Error("ffmpeg not found: brew install ffmpeg, or npx playwright install ffmpeg");
}

/**
 * Film a page through Chrome's own screencast (works on a Chrome we only
 * attached to). Frames land in a temp folder with their timestamps and are
 * turned into an mp4 by ffmpeg when the scene ends.
 */
async function startScreencast(page, n) {
  const dir = path.join(RAW, `.frames-${String(n).padStart(2, "0")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  return async function stop() {
    const tEnd = Date.now() / 1000;
    try { await cdp.send("Page.stopScreencast"); } catch {}
    await sleep(300);
    if (frames.length < 1) throw new Error("screencast produced no frames (was the tab in front?)");
    // Chrome only sends a frame when something changed, so hold the last one
    // until the moment recording stopped; otherwise a still page ends early.
    frames.push({ file: frames[frames.length - 1].file, t: Math.max(tEnd, frames[frames.length - 1].t + 0.5) });
    // Resample the variable-rate frames to a fixed 30 fps image sequence. This
    // needs only the image2 demuxer, which every ffmpeg build has, including
    // Playwright's small one (which lacks the concat demuxer and libx264).
    const FPS = 30;
    const seq = path.join(dir, "seq");
    mkdirSync(seq, { recursive: true });
    let idx = 0;
    frames.forEach((f, i) => {
      const next = frames[i + 1];
      const d = next ? Math.max(1 / FPS, next.t - f.t) : 0.5;
      const copies = Math.max(1, Math.round(d * FPS));
      for (let k = 0; k < copies; k++) symlinkSync(f.file, path.join(seq, `s${String(idx++).padStart(6, "0")}.jpg`));
    });
    const bin = ffmpegBin();
    const system = bin === "ffmpeg";
    const out = path.join(RAW, `${String(n).padStart(2, "0")}.${system ? "mp4" : "webm"}`);
    const vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";
    const codec = system ? ["-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p"] : ["-c:v", "libvpx", "-b:v", "6M", "-pix_fmt", "yuv420p"];
    const input = ["-v", "error", "-y", "-framerate", String(FPS), "-i", path.join(seq, "s%06d.jpg")];
    try {
      execFileSync(bin, [...input, "-vf", vf, ...codec, out], { stdio: "inherit" });
    } catch {
      log("  ffmpeg could not scale; writing the frames as they are");
      execFileSync(bin, [...input, ...codec, out], { stdio: "inherit" });
    }
    rmSync(dir, { recursive: true, force: true });
    return out;
  };
}

/** Record one scene: open a page, run `drive`, hold for slot+2 s, save the video. */
async function record(context, scene, drive) {
  const page = await context.newPage();
  if (CDP) { try { await page.setViewportSize(SIZE); } catch {} }
  const stop = CDP ? await startScreencast(page, scene.n) : null;
  const t0 = Date.now();
  log(`Scene ${scene.n} · ${scene.title} · ${scene.slot}s`);
  try {
    await drive(page);
  } catch (e) {
    log(`  ! ${e.message}`);
  }
  const hold = (scene.slot + EXTRA_S) * 1000 - (Date.now() - t0);
  if (hold > 0) await sleep(hold);
  if (stop) {
    const out = await stop();
    await page.close();
    log(`  saved ${path.relative(repo, out)}`);
    return;
  }
  const video = page.video();
  await page.close();
  if (video) {
    const src = await video.path();
    const dst = path.join(RAW, `${String(scene.n).padStart(2, "0")}.webm`);
    renameSync(src, dst);
    log(`  saved ${path.relative(repo, dst)}`);
  }
}

const scene = (n) => cfg.scenes.find((s) => s.n === n);

/** On a portal home page, open the first quote whose status pill says Countered. */
async function openCounteredQuote(p) {
  const row = p.locator("li.quote-list-row").filter({ has: p.locator(".status-countered") }).first();
  await row.getByRole("link").first().click();
  await p.getByRole("button", { name: /Accept & create order/ }).waitFor();
}

/** Pick the payment-terms option whose label mentions Net 30 (or the first Net option). */
async function pickNet30(p) {
  const sel = p.locator("select[name=paymentTermsTemplateId]").first();
  const labels = await sel.locator("option").allTextContents();
  let i = labels.findIndex((t) => /net\s*30/i.test(t));
  if (i < 0) i = labels.findIndex((t) => /net\s*\d+/i.test(t));
  if (i < 0) throw new Error(`no Net terms among: ${labels.join(" | ")}`);
  await sel.selectOption({ index: i });
}

// ---------------------------------------------------------------- drivers

const drivers = {
  1: async (p) => { await p.goto(cfg.landing); },

  2: async (p) => {
    await p.goto(APP);
    const f = await appFrame(p);
    await tryStep("hover the nav", async () => {
      for (const item of ["Quotes", "Quote forms", "Buyers", "Analytics", "Settings", "Pricing plans"]) {
        await f.getByRole("link", { name: item, exact: true }).first().hover();
        await sleep(900);
      }
    }, 12000);
  },

  3: async (p) => { await p.goto(APP); await appFrame(p); },

  4: async (p) => {
    await p.goto(`${APP}/quotes`);
    const f = await appFrame(p);
    await tryStep(`find a New quote from ${COMPANY || "any company"}`, async () => {
      let rows = f.getByRole("row").filter({ hasText: "New" });
      if (COMPANY && (await rows.filter({ hasText: COMPANY }).count()) > 0) rows = rows.filter({ hasText: COMPANY });
      const row = rows.first();
      await row.hover();
      const text = (await row.textContent()) ?? "";
      state.buyerEmail = text.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? null;
      const link = row.getByRole("link").first();
      const href = await link.getAttribute("href");
      if (href) state.quoteUrl = href.startsWith("http") ? href : `${APP.replace(/\/app$/, "")}${href}`;
    });
  },

  5: async (p) => {
    await p.goto(state.quoteUrl ?? `${APP}/quotes`);
    const f = await appFrame(p);
    if (!state.quoteUrl) {
      await tryStep("open a New quote", async () => {
        let rows = f.getByRole("row").filter({ hasText: "New" });
        if (COMPANY && (await rows.filter({ hasText: COMPANY }).count()) > 0) rows = rows.filter({ hasText: COMPANY });
        await rows.first().getByRole("link").first().click();
        state.quoteUrl = p.url();
      });
    }
    await tryStep("wait for Totals from Shopify", async () => {
      await f.getByText("Totals from Shopify").first().waitFor();
    }, 20000);
  },

  6: async (p) => {
    await p.goto(state.quoteUrl ?? `${APP}/quotes`);
    const f = await appFrame(p);
    await sleep(1500);
    await tryStep("Draft all lines with Claude", async () => {
      await f.getByRole("button", { name: /Draft all lines with Claude/ }).first().click();
      await f.getByRole("button", { name: "Use this price" }).first().waitFor();
    }, 25000);
    await sleep(1500);
    await tryStep("Use this price on the first line", async () => {
      await f.getByRole("button", { name: "Use this price" }).first().click();
    });
  },

  7: async (p) => {
    await p.goto(state.quoteUrl ?? `${APP}/quotes`);
    const f = await appFrame(p);
    await sleep(2500);
    await tryStep("Send counter", async () => {
      await f.getByRole("button", { name: "Send counter" }).first().click();
      await f.getByText("Counter sent to the buyer").first().waitFor();
    }, 20000);
  },

  8: async (p) => {
    await p.goto(`${APP}/buyers`);
    const f = await appFrame(p);
    await sleep(2000);
    await tryStep("Generate link", async () => {
      const rows = f.getByRole("row").filter({ hasText: "Generate link" });
      let row = rows.first();
      for (const key of [process.env.MANNON_VIDEO_BUYER, state.buyerEmail, COMPANY]) {
        if (key && (await rows.filter({ hasText: key }).count()) > 0) { row = rows.filter({ hasText: key }).first(); log(`    buyer row: ${key}`); break; }
      }
      await row.getByRole("button", { name: "Generate link" }).click();
      await f.getByText("Magic link ready to send").waitFor();
      state.magicLink = (await f.locator("code").first().textContent())?.trim() ?? null;
    }, 20000);
    await sleep(1200);
    await tryStep("Copy link", async () => { await f.getByRole("button", { name: "Copy link" }).click(); });
  },

  9: async (p) => {
    if (!state.magicLink) throw new Error("no magic link from scene 8; run scenes 8 and 9 together");
    await p.goto(state.magicLink);
    await tryStep("Continue", async () => { await p.getByRole("button", { name: "Continue" }).click(); });
    await sleep(1500);
    await tryStep("open the Countered quote", () => openCounteredQuote(p));
    await sleep(1500);
    await tryStep("pick Net 30", () => pickNet30(p));
    await sleep(1200);
    await tryStep("Accept & create order", async () => { await p.getByRole("button", { name: /Accept & create order/ }).click(); });
    await sleep(2500);
    await tryStep("Confirm & create order", async () => {
      await p.getByRole("button", { name: /Confirm & create order/ }).click();
      await p.locator(".status-ordered").or(p.getByText("Ordered", { exact: true })).first().waitFor();
    }, 40000, p);
  },

  10: async (p) => {
    await p.goto(`${ADMIN}/draft_orders`);
    await sleep(3000);
    await tryStep("open the newest draft", async () => {
      await p.getByRole("row").nth(1).getByRole("link").first().click();
    });
  },

  11: async (p) => {
    // The reorder card comes from the demo company's seeded order, so this
    // scene runs as a demo buyer rather than the magic-link buyer.
    await p.goto(cfg.landing);
    await tryStep("Open the buyer demo", async () => {
      await p.getByRole("link", { name: /Open the buyer demo/ }).first().click();
      await p.getByText("Reorder a past order").first().waitFor();
    }, 20000);
    await sleep(1500);
    await tryStep("Reorder", async () => {
      await p.locator("li.quote-list-row").getByRole("link", { name: "Reorder", exact: true }).first().click();
      await p.getByRole("button", { name: "Send reorder" }).waitFor();
    });
    await sleep(2500);
    await tryStep("Send reorder", async () => {
      await p.getByRole("button", { name: "Send reorder" }).click();
      await p.waitForURL(/\/portal\/quotes\//, { timeout: 20000 });
    }, 25000);
  },

  12: async (p) => {
    if (!state.magicLink) throw new Error("no magic link from scene 8");
    await p.goto(state.magicLink.replace(/\/portal\/auth.*$/, "/portal/quick-order"));
    await sleep(1500);
    await tryStep("Paste a PO or email", async () => { await p.getByText(/Paste a PO or email/).first().click(); }, 5000);
    await tryStep("type the lines", async () => {
      const box = p.getByRole("textbox").last();
      await box.fill(process.env.MANNON_VIDEO_SKUS ?? "Hi, please send\n20x sku-untracked-1\n5x sku-managed-1\nThanks");
    });
    await tryStep("Read my order", async () => {
      await p.getByRole("button", { name: "Read my order" }).click();
      await p.getByRole("button", { name: /Request quote for these items/ }).waitFor();
    }, 30000);
  },

  13: async (p) => { await p.goto(`${APP}/analytics`); await appFrame(p); },

  14: async (p) => {
    const third = Math.floor((scene(14).slot + EXTRA_S) * 1000 / 3);
    if (process.env.MANNON_VIDEO_PRODUCT_URL) {
      await p.goto(process.env.MANNON_VIDEO_PRODUCT_URL);
    } else {
      log("  ! MANNON_VIDEO_PRODUCT_URL not set: showing Settings for the first third instead");
      await p.goto(`${APP}/settings`);
    }
    await sleep(third);
    await p.goto(`${APP}/settings`);
    await appFrame(p);
    await sleep(third);
    await p.goto(`${APP}/plans`);
    const f = await appFrame(p);
    await tryStep("Choose Scale", async () => { await f.getByRole("button", { name: /Choose Scale/ }).click(); }, 8000);
  },

  15: async (p) => {
    await p.goto(cfg.landing);
    await sleep(1500);
    await tryStep("Open the buyer demo", async () => { await p.getByRole("link", { name: /Open the buyer demo/ }).first().click(); });
    await sleep(3000);
    await tryStep("open the Countered quote", () => openCounteredQuote(p));
    await sleep(2000);
    await tryStep("Accept & create order", async () => { await p.getByRole("button", { name: /Accept & create order/ }).click(); });
    await sleep(2000);
    await tryStep("Confirm & create order", async () => {
      await p.getByRole("button", { name: /Confirm & create order/ }).click();
      await p.getByText("Ordered").first().waitFor();
    }, 25000);
  },

  16: async (p) => {
    const card = path.join(repo, "store", "listing", "Mannon-Close-Card.html");
    await p.goto(existsSync(card) ? `file://${card}` : cfg.landing);
  },
};

// ---------------------------------------------------------------- main

const adminScenes = cfg.scenes.filter((s) => s.kind === "admin" && want(s.n));
const otherScenes = cfg.scenes.filter((s) => s.kind !== "admin" && want(s.n));

let admin = null;
let cdpBrowser = null;
if (CDP) {
  log(`attaching to Chrome at ${CDP}`);
  cdpBrowser = await chromium.connectOverCDP(CDP);
  admin = cdpBrowser.contexts()[0];
  if (!admin) throw new Error("no browser context over CDP; is Chrome open?");
  if (adminScenes.length > 0 || want(8)) {
    const probe = await admin.newPage();
    await waitForSignIn(probe);
    await probe.close();
  }
} else if (adminScenes.length > 0 || want(8)) {
  admin = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: SIZE,
    recordVideo: { dir: RAW, size: SIZE },
    args: ["--window-size=1920,1120", "--hide-scrollbars"],
  });
  const probe = await admin.newPage();
  await waitForSignIn(probe);
  await probe.close();
}

const buyer = CDP ? null : await chromium.launch({ channel: "chrome", headless: false });
const buyerCtx = CDP
  ? await cdpBrowser.newContext({ viewport: SIZE })
  : await buyer.newContext({ viewport: SIZE, recordVideo: { dir: RAW, size: SIZE } });

for (const s of cfg.scenes) {
  if (!want(s.n)) continue;
  const ctx = s.kind === "admin" ? admin : buyerCtx;
  if (!ctx) continue;
  await record(ctx, s, drivers[s.n]);
}

await buyerCtx.close();
if (buyer) await buyer.close();
if (CDP) { log("leaving your Chrome open"); }
else if (admin) await admin.close();
log("done. Clips are in docs/video/menna/raw/. Delete the demo draft orders and held reorder quotes on the store; keep order #1001.");
