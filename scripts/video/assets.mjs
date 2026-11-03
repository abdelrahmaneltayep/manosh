// Renders the edit's small picture and sound assets into docs/video/menna/cut/assets:
//   cursor.png            a soft black pointer with a white edge (brand guide §9)
//   ripple-00..19.png     the indigo click ripple, 20 frames (60 → 120 px, fading)
//   click.wav, swish.wav  a short tick for clicks and a quiet swish for scene changes
// Pictures come from Chrome via Playwright; sounds are synthesised by ffmpeg.

import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..", "..");
export const ASSETS = path.join(repo, "docs", "video", "menna", "cut", "assets");
mkdirSync(ASSETS, { recursive: true });

const cursorHtml = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>
<svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 3 L6 33 L13.5 26.5 L18.5 38 L24.5 35.5 L19.5 24.5 L29.5 24 Z" fill="#111" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" opacity="0.95"/>
</svg>`;

const rippleHtml = (p) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;width:120px;height:120px}
.r{position:absolute;left:50%;top:50%;width:${60 + 60 * p}px;height:${60 + 60 * p}px;margin-left:${-(30 + 30 * p)}px;margin-top:${-(30 + 30 * p)}px;
border-radius:50%;background:#4f46e5;opacity:${(0.35 * (1 - p)).toFixed(3)}}</style><div class="r"></div>`;

export async function ensureAssets() {
  if (!existsSync(path.join(ASSETS, "ripple-19.png"))) {
    const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
    const page = await browser.newPage({ viewport: { width: 36, height: 44 }, deviceScaleFactor: 1 });
    await page.setContent(cursorHtml);
    await page.screenshot({ path: path.join(ASSETS, "cursor.png"), omitBackground: true });
    await page.setViewportSize({ width: 120, height: 120 });
    for (let i = 0; i < 20; i++) {
      await page.setContent(rippleHtml(i / 19));
      await page.screenshot({ path: path.join(ASSETS, `ripple-${String(i).padStart(2, "0")}.png`), omitBackground: true });
    }
    await browser.close();
  }
  if (!existsSync(path.join(ASSETS, "click.wav"))) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
      "aevalsrc=0.55*sin(2*PI*1900*t)*exp(-t*140)+0.25*sin(2*PI*520*t)*exp(-t*70):d=0.12:s=48000",
      "-ac", "2", path.join(ASSETS, "click.wav")]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=0.6:c=pink:a=0.6:r=48000",
      "-af", "lowpass=f=900,afade=t=in:d=0.25,afade=t=out:st=0.25:d=0.35,volume=0.12", "-ac", "2", path.join(ASSETS, "swish.wav")]);
  }
  return ASSETS;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await ensureAssets();
  console.log(`assets in ${path.relative(repo, ASSETS)}`);
}
