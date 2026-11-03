// Renders every caption in scenes.json as a transparent PNG lower-third pill
// (brand: ink #1c1d2b, white 800 28px, radius 14, padding 18x32), using
// Chrome through Playwright. The assembly overlays these PNGs, so it never
// depends on ffmpeg's drawtext filter, which not every build has.
//
//   node scripts/video/captions.mjs            → docs/video/menna/cut/cap-NN-a.png, cap-NN-b.png

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..", "..");
const cfg = JSON.parse(readFileSync(path.join(here, "scenes.json"), "utf8"));
const OUT = path.join(repo, "docs", "video", "menna", "cut");
mkdirSync(OUT, { recursive: true });

const html = (text) => `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  body { width: 1920px; height: 120px; display: flex; align-items: flex-end; justify-content: center; }
  .pill { font: 800 28px/1.25 Inter, -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #fff; background: #1c1d2b; border-radius: 14px; padding: 18px 32px; margin-bottom: 0;
    letter-spacing: -0.01em; white-space: nowrap; }
</style>
<body><div class="pill">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div></body>`;

const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
const page = await browser.newPage({ viewport: { width: 1920, height: 120 }, deviceScaleFactor: 1 });
for (const s of cfg.scenes) {
  for (const [k, text] of [["a", s.captionA], ["b", s.captionB]]) {
    await page.setContent(html(text));
    const file = path.join(OUT, `cap-${String(s.n).padStart(2, "0")}-${k}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    console.log(`caption ${s.n}${k}: ${text}`);
  }
}
await browser.close();
