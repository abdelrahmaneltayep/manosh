// Assembles the walkthrough from the recorded clips, the voice files and the
// click log: per scene, a cursor that eases to every button and clicks with
// an indigo ripple and a tick, the lower-third captions, the voice; then all
// scenes joined with cross-fades and a quiet swish on each cut. No music.
//
//   node scripts/video/assemble.mjs           → docs/video/menna/mannon-walkthrough-menna.mp4
//
// Needs a full ffmpeg (brew install ffmpeg) and the Chrome-rendered captions
// and assets (made here on the fly).

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ensureAssets } from "./assets.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..", "..");
const cfg = JSON.parse(readFileSync(path.join(here, "scenes.json"), "utf8"));
const RAW = path.join(repo, "docs", "video", "menna", "raw");
const VO = path.join(repo, "docs", "video", "menna", "vo");
const CUT = path.join(repo, "docs", "video", "menna", "cut");
const OUT = path.join(repo, "docs", "video", "menna", "mannon-walkthrough-menna.mp4");
const W = 1920, H = 1080, FPS = 30;
const FADE = 0.45;      // cross-fade between scenes (brand guide §9)
const MOVE = 0.7;       // seconds the cursor takes to reach a target
const RIPPLE = 20 / FPS;

const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const nn = (n) => String(n).padStart(2, "0");
const num = (v) => Number(v).toFixed(3);

/** Cursor keyframes from the click log, in output-frame coordinates. */
function keyframes(n) {
  const file = path.join(RAW, `${nn(n)}.events.json`);
  if (!existsSync(file)) return [];
  const { viewport, events } = JSON.parse(readFileSync(file, "utf8"));
  const s = Math.min(W / viewport.width, H / viewport.height);
  const ox = (W - viewport.width * s) / 2, oy = (H - viewport.height * s) / 2;
  return events.map((e) => ({ t: e.t, x: ox + e.x * s, y: oy + e.y * s, click: e.kind === "click" }));
}

/** Piecewise ffmpeg expression for one cursor axis: hold, then ease (cubic out) to the next target. */
function axisExpr(keys, axis) {
  const v = (k) => num(keys[k][axis]);
  const first = keys[0];
  const from0 = axis === "x" ? first.x - 260 : first.y + 180;   // the pointer slides in from down-left
  let expr = v(keys.length - 1);
  for (let k = keys.length - 1; k >= 0; k--) {
    const prev = k === 0 ? num(from0) : v(k - 1);
    const tEnd = keys[k].t;
    const tStart = Math.max(tEnd - MOVE, k === 0 ? tEnd - MOVE : keys[k - 1].t);
    const d = Math.max(0.05, tEnd - tStart);
    const ease = `(1-pow(1-(t-${num(tStart)})/${num(d)},3))`;
    expr = `if(lt(t,${num(tStart)}),${prev},if(lt(t,${num(tEnd)}),${prev}+(${v(k)}-${prev})*${ease},${expr}))`;
  }
  return expr;
}

function cutScene(scene, assets) {
  const raw = readdirSync(RAW).find((f) => f.startsWith(`${nn(scene.n)}.`) && /\.(mp4|webm|mov)$/.test(f));
  if (!raw) throw new Error(`scene ${scene.n}: no clip in ${path.relative(repo, RAW)}`);
  const vo = path.join(VO, `${nn(scene.n)}.wav`);
  if (!existsSync(vo)) throw new Error(`scene ${scene.n}: no voice ${path.relative(repo, vo)} (run normalise)`);
  const len = scene.slot + FADE;                 // extra tail that the next scene fades over
  const swap = scene.slot * 0.52;
  const keys = keyframes(scene.n);
  const clicks = keys.filter((k) => k.click);
  const last = scene.n === cfg.scenes[cfg.scenes.length - 1].n;

  const inputs = ["-i", path.join(RAW, raw), "-i", vo, "-i", path.join(CUT, `cap-${nn(scene.n)}-a.png`), "-i", path.join(CUT, `cap-${nn(scene.n)}-b.png`),
    "-loop", "1", "-i", path.join(assets, "cursor.png")];
  let idx = 5;
  const rippleIdx = [];
  for (const c of clicks) { inputs.push("-framerate", String(FPS), "-i", path.join(assets, "ripple-%02d.png")); rippleIdx.push(idx++); }
  const clickIdx = [];
  for (const c of clicks) { inputs.push("-i", path.join(assets, "click.wav")); clickIdx.push(idx++); }
  let swishIdx = null;
  if (!last) { inputs.push("-i", path.join(assets, "swish.wav")); swishIdx = idx++; }

  const f = [];
  f.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=${len}[base]`);
  let v = "base";
  if (keys.length) {
    const show = Math.max(0, keys[0].t - MOVE);
    f.push(`[${v}][4:v]overlay=x='${axisExpr(keys, "x")}-6':y='${axisExpr(keys, "y")}-3':enable='gte(t,${num(show)})':eof_action=pass[vc]`);
    v = "vc";
  }
  clicks.forEach((c, i) => {
    f.push(`[${rippleIdx[i]}:v]setpts=PTS-STARTPTS+${num(c.t)}/TB[r${i}]`);
    f.push(`[${v}][r${i}]overlay=x=${num(c.x - 60)}:y=${num(c.y - 60)}:eof_action=pass[vr${i}]`);
    v = `vr${i}`;
  });
  f.push(`[${v}][2:v]overlay=0:H-h-60:enable='lt(t,${num(swap)})'[vca]`);
  f.push(`[vca][3:v]overlay=0:H-h-60:enable='gte(t,${num(swap)})'[v]`);

  const mix = ["[voice]"];
  f.push(`[1:a]apad[voice]`);
  clicks.forEach((c, i) => { const ms = Math.round(c.t * 1000); f.push(`[${clickIdx[i]}:a]adelay=${ms}|${ms}[ck${i}]`); mix.push(`[ck${i}]`); });
  if (swishIdx != null) { const ms = Math.round((scene.slot - FADE) * 1000); f.push(`[${swishIdx}:a]adelay=${ms}|${ms}[sw]`); mix.push("[sw]"); }
  f.push(`${mix.join("")}amix=inputs=${mix.length}:normalize=0:dropout_transition=0[a]`);

  const out = path.join(CUT, `${nn(scene.n)}.mp4`);
  ff([...inputs, "-filter_complex", f.join(";"), "-map", "[v]", "-map", "[a]", "-t", num(len),
    "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", out]);
  console.log(`scene ${scene.n}: ${scene.slot}s, ${clicks.length} click(s), ${keys.length - clicks.length} hover(s)`);
  return out;
}

function join(cuts) {
  const inputs = cuts.flatMap((c) => ["-i", c]);
  const f = [];
  let v = "0:v", a = "0:a", offset = 0;
  cfg.scenes.forEach((s, i) => {
    if (i === 0) return;
    offset += cfg.scenes[i - 1].slot;
    f.push(`[${v}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${num(offset)}[v${i}]`);
    f.push(`[${a}][${i}:a]acrossfade=d=${FADE}:c1=tri:c2=tri[a${i}]`);
    v = `v${i}`; a = `a${i}`;
  });
  const total = cfg.scenes.reduce((t, s) => t + s.slot, 0);
  ff([...inputs, "-filter_complex", f.join(";"), "-map", `[${v}]`, "-map", `[${a}]`, "-t", String(total),
    "-c:v", "libx264", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", OUT]);
  console.log(`wrote ${path.relative(repo, OUT)} (${total}s)`);
}

const assets = await ensureAssets();
execFileSync("node", [path.join(here, "captions.mjs")], { stdio: "inherit" });
const cuts = cfg.scenes.map((s) => cutScene(s, assets));
join(cuts);
