#!/usr/bin/env python3
"""
Mannon — App Store listing cut builder (Part 1 core reel, <=60s, 1600x900).

Pure-pipeline screencast: 9 branded HTML frames -> PNG (headless Chromium) ->
ffmpeg (Ken-Burns zoompan + 0.6s xfade crossfades + soft synthesized ambient
bed, 2s fade-in / 3s fade-out) -> mannon-demo.mp4.

No cloud GPU, no voiceover, no external assets. Captions carry the story.
Brand: indigo #4F46E5 · lime #A3E635 (fill only, never text) · ink #1A1A2E ·
cream #FBF8F4 end card. WCAG AA: every caption/headline is ink or indigo.

Run:  python3 build_mannon_video.py
"""
import os, subprocess, glob, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "frames")
PNG = os.path.join(HERE, "png")
OUT = os.path.join(HERE, "mannon-demo.mp4")
os.makedirs(FRAMES, exist_ok=True)
os.makedirs(PNG, exist_ok=True)

def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def chrome_exe():
    for p in glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"):
        return p
    for root, _, files in os.walk("/opt/pw-browsers"):
        if "chrome" in files:
            return os.path.join(root, "chrome")
    raise RuntimeError("chromium not found")

# ---------------------------------------------------------------- brand + shell
CSS = """
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1600px;height:900px;overflow:hidden}
body{font-family:'Inter','Segoe UI',system-ui,'DejaVu Sans',sans-serif;
  color:#1A1A2E;position:relative;
  background:linear-gradient(135deg,__TINT1__ 0%,__TINT2__ 62%,#FBF8F4 100%);}
.stage{position:absolute;inset:0;padding:76px 92px;display:flex;flex-direction:column}
/* brand lockup */
.brand{display:flex;align-items:center;gap:16px}
.mark{width:52px;height:52px;border-radius:14px;background:#4F46E5;
  box-shadow:0 10px 26px rgba(79,70,229,.34);display:flex;align-items:center;
  justify-content:center;color:#fff;font-weight:800;font-size:30px;letter-spacing:-1px}
.word{font-weight:800;font-size:27px;letter-spacing:-.5px;color:#1A1A2E}
.eyebrow{margin-left:auto;font-weight:700;font-size:16px;letter-spacing:.14em;
  text-transform:uppercase;color:#4F46E5;opacity:.85}
/* central content */
.body{flex:1;display:flex;align-items:center;justify-content:center;gap:56px}
.caption{position:absolute;left:92px;right:92px;bottom:64px}
.cap-main{font-weight:800;font-size:52px;line-height:1.06;letter-spacing:-1.2px;
  color:#1A1A2E;max-width:1180px}
.cap-main .hi{color:#4F46E5}
.cap-sub{margin-top:14px;font-weight:600;font-size:24px;color:#3a3a55;opacity:.9}
.tick{display:inline-block;width:44px;height:6px;border-radius:6px;background:#4F46E5;
  margin-bottom:22px}
/* generic UI panel */
.panel{background:#fff;border-radius:24px;box-shadow:0 34px 80px rgba(26,26,46,.16),
  0 4px 12px rgba(26,26,46,.06);border:1px solid rgba(26,26,46,.06)}
.p-head{display:flex;align-items:center;gap:12px;padding:20px 26px;
  border-bottom:1px solid #EEF0F4}
.dot{width:12px;height:12px;border-radius:50%}
.p-title{font-weight:700;font-size:19px;margin-left:6px;color:#1A1A2E}
.p-body{padding:26px}
.row{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;
  border:1px solid #EEF0F4;border-radius:14px;margin-bottom:12px;background:#FCFCFE}
.row .l{display:flex;align-items:center;gap:14px}
.thumb{width:44px;height:44px;border-radius:11px;background:#EEF0FF}
.lbl{font-weight:700;font-size:18px;color:#1A1A2E}
.sub{font-weight:600;font-size:14px;color:#8a8aa0}
.money{font-weight:800;font-size:19px;color:#1A1A2E}
.badge{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:999px;
  font-weight:700;font-size:14px}
.badge.indigo{background:#EEF0FF;color:#4F46E5}
.badge.lime{background:#A3E635;color:#1A1A2E}
.badge.ghost{background:#F3F4F8;color:#5b5b74}
.btn{padding:14px 26px;border-radius:13px;font-weight:800;font-size:19px;border:none}
.btn.primary{background:#4F46E5;color:#fff;box-shadow:0 12px 26px rgba(79,70,229,.32)}
.btn.lime{background:#A3E635;color:#1A1A2E;box-shadow:0 12px 26px rgba(163,230,53,.4)}
.ai{background:linear-gradient(120deg,#EEF0FF,#F6F0FF);border:1px solid #DAD8FF;
  border-radius:16px;padding:20px 22px}
.ai-tag{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:14px;
  color:#4F46E5;letter-spacing:.05em;margin-bottom:10px}
.spark{width:20px;height:20px;border-radius:6px;background:#4F46E5;color:#fff;
  display:inline-flex;align-items:center;justify-content:center;font-size:13px}
.phone{width:330px;height:660px;background:#1A1A2E;border-radius:44px;padding:14px;
  box-shadow:0 40px 90px rgba(26,26,46,.28)}
.screen{width:100%;height:100%;background:#FBF8F4;border-radius:32px;overflow:hidden;
  display:flex;flex-direction:column}
.notch{height:26px;display:flex;align-items:center;justify-content:center}
.notch i{width:110px;height:7px;border-radius:5px;background:#c9c9d6;display:block}
.pill{display:inline-flex;align-items:center;gap:8px;padding:8px 15px;border-radius:999px;
  background:#EEF0FF;color:#4F46E5;font-weight:700;font-size:14px}
.bar{height:12px;border-radius:6px;background:#EAEAF2}
.ktitle{font-weight:800;font-size:15px;letter-spacing:.06em;text-transform:uppercase;
  color:#8a8aa0;margin-bottom:14px}
.kcard{background:#fff;border:1px solid #EEF0F4;border-radius:14px;padding:16px 18px;
  box-shadow:0 8px 18px rgba(26,26,46,.05);margin-bottom:12px}
.stat{font-weight:800;font-size:46px;letter-spacing:-1.5px;color:#1A1A2E;line-height:1}
.stat .u{font-size:24px;color:#4F46E5}
.price{background:#fff;border-radius:20px;border:1px solid #EEF0F4;padding:26px 22px;
  box-shadow:0 20px 44px rgba(26,26,46,.08);text-align:center;flex:1}
.price.feat{border:2px solid #4F46E5;box-shadow:0 26px 56px rgba(79,70,229,.2);
  transform:translateY(-10px)}
.price h4{font-weight:800;font-size:20px;color:#1A1A2E;margin-bottom:8px}
.price .amt{font-weight:800;font-size:44px;letter-spacing:-1.5px;color:#1A1A2E}
.price .amt small{font-size:18px;color:#8a8aa0;font-weight:700}
.price .amt .free{color:#4F46E5}
.check{width:26px;height:26px;border-radius:50%;background:#A3E635;display:inline-flex;
  align-items:center;justify-content:center;color:#1A1A2E;font-weight:900;font-size:16px}
.end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:26px;background:#FBF8F4}
.end .mark{width:104px;height:104px;border-radius:28px;font-size:60px}
.end h1{font-weight:800;font-size:64px;letter-spacing:-2px;color:#1A1A2E}
.end p{font-weight:700;font-size:27px;color:#4F46E5}
.end .s{font-weight:600;font-size:20px;color:#6b6b82;margin-top:-8px}
"""

SHELL = """<!doctype html><html><head><meta charset="utf-8"><style>__CSS__</style></head>
<body style="__BODYX__">__RAW__<div class="stage" style="__STAGEX__">
<div class="brand"><div class="mark">M</div><div class="word">Mannon</div>
<div class="eyebrow">__EYEBROW__</div></div>
<div class="body">__CONTENT__</div>
<div class="caption"><span class="tick"></span>
<div class="cap-main">__CAPTION__</div>__SUB__</div>
</div></body></html>"""

def slide(tint1, tint2, eyebrow, caption, content, sub="", raw="", bodyx="", stagex=""):
    sub_html = f'<div class="cap-sub">{sub}</div>' if sub else ""
    html = (SHELL
        .replace("__CSS__", CSS.replace("__TINT1__", tint1).replace("__TINT2__", tint2))
        .replace("__EYEBROW__", eyebrow)
        .replace("__CAPTION__", caption)
        .replace("__CONTENT__", content)
        .replace("__SUB__", sub_html)
        .replace("__RAW__", raw)
        .replace("__BODYX__", bodyx)
        .replace("__STAGEX__", stagex))
    return html

# ------------------------------------------------------------------- 9 frames
def frames_def():
    F = []

    # 1 — the pain
    F.append(slide("#F4E9E9", "#F6EEE9", "The problem",
        'Wholesale still runs on <span class="hi">email</span>.',
        """<div class="panel" style="width:920px;opacity:.96">
        <div class="p-head"><span class="dot" style="background:#f45b5b"></span>
        <span class="dot" style="background:#f5b73d"></span><span class="dot" style="background:#cfd2dc"></span>
        <span class="p-title">Re: Re: Re: wholesale pricing?</span>
        <span class="badge ghost" style="margin-left:auto">Inbox · 14</span></div>
        <div class="p-body">
        <div class="row"><div class="l"><div class="thumb" style="border-radius:50%"></div>
        <div><div class="lbl">Reef Trading</div><div class="sub">can you do better on 500 units?</div></div></div>
        <span class="sub">9:41</span></div>
        <div class="row"><div class="l"><div class="thumb" style="border-radius:50%"></div>
        <div><div class="lbl">You</div><div class="sub">let me check with the team…</div></div></div>
        <span class="sub">11:20</span></div>
        <div class="row" style="opacity:.6"><div class="l"><div class="thumb" style="border-radius:50%"></div>
        <div><div class="lbl">Reef Trading</div><div class="sub">following up — still waiting 🙏</div></div></div>
        <span class="sub">2 days</span></div>
        </div></div>""",
        sub="Quotes by email. Reorders by hand. Mannon fixes that."))

    # 2 — build a quote + AI counter (hero)
    F.append(slide("#EAECFF", "#EEF0FF", "F1 · F3 — Quote + AI",
        'Build a B2B quote — <span class="hi">AI drafts the counter-offer</span>.',
        """<div class="panel" style="width:1000px">
        <div class="p-head"><span class="dot" style="background:#4F46E5"></span>
        <span class="p-title">Quote · Gulf Medical Supplies</span>
        <span class="badge indigo" style="margin-left:auto">Price list: Clinic tier</span></div>
        <div class="p-body">
        <div class="row"><div class="l"><div class="thumb"></div>
        <div><div class="lbl">Nitrile gloves · M</div><div class="sub">240 units · list $0.42</div></div></div>
        <span class="money">$92.40</span></div>
        <div class="row"><div class="l"><div class="thumb"></div>
        <div><div class="lbl">Alcohol wipes</div><div class="sub">120 units · list $3.10</div></div></div>
        <span class="money">$372.00</span></div>
        <div class="ai" style="margin-top:6px">
        <div class="ai-tag"><span class="spark">✦</span> AI counter-offer · margin-safe</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="lbl" style="font-size:20px">Offer <b>$438</b> &nbsp;·&nbsp; holds a <b>31%</b> margin</div>
        <button class="btn primary">Accept suggestion</button></div></div>
        </div></div>""",
        sub="Native Shopify draft order — you never recompute the math."))

    # 3 — buyer portal, magic link
    F.append(slide("#E6F5F1", "#EAF6EE", "Magic link · F18",
        'Your buyer opens it — <span class="hi">no password, no account</span>.',
        """<div class="phone"><div class="screen">
        <div class="notch"><i></i></div>
        <div style="padding:22px 22px 0">
        <div class="brand" style="gap:10px"><div class="mark" style="width:34px;height:34px;font-size:20px;border-radius:9px">M</div>
        <div class="word" style="font-size:18px">Mannon</div></div>
        <div style="margin-top:20px" class="pill">🔒 Secure link · no login</div>
        <div style="margin-top:20px;font-weight:800;font-size:23px;color:#1A1A2E">Quote #1042</div>
        <div class="sub" style="margin-top:4px">Gulf Medical Supplies</div>
        <div class="kcard" style="margin-top:18px">
        <div style="display:flex;justify-content:space-between"><span class="lbl" style="font-size:16px">2 items</span>
        <span class="money">$438.00</span></div>
        <div class="bar" style="width:80%;margin-top:14px"></div>
        <div class="bar" style="width:55%;margin-top:10px"></div></div>
        <button class="btn primary" style="width:100%;margin-top:18px">Review &amp; accept</button>
        </div></div></div>
        <div class="panel" style="width:560px;padding:34px 36px">
        <div class="ai-tag"><span class="spark" style="background:#10b981">✓</span> Opens instantly</div>
        <div style="font-weight:800;font-size:30px;letter-spacing:-1px;line-height:1.15">One tap from the email.<br>Branded. Mobile. Yours.</div>
        <div class="sub" style="margin-top:16px;font-size:17px">No Shopify account. No portal password. The buyer just… opens it.</div>
        </div>""",
        sub=""))

    # 4 — the accept beat (money shot, lime fill)
    F.append(slide("#EDF6DC", "#F2F7E4", "The accept beat",
        'They accept in <span class="hi">one tap</span>.',
        """<div class="panel" style="width:820px;text-align:center">
        <div class="p-body" style="padding:56px 48px">
        <div style="width:130px;height:130px;border-radius:50%;background:#A3E635;margin:0 auto;
        display:flex;align-items:center;justify-content:center;box-shadow:0 20px 50px rgba(163,230,53,.5)">
        <span style="font-size:74px;color:#1A1A2E;font-weight:900">✓</span></div>
        <div style="margin-top:28px;font-weight:800;font-size:36px;letter-spacing:-1px">Quote accepted</div>
        <div class="sub" style="font-size:19px;margin-top:8px">Gulf Medical Supplies · $438.00</div>
        <div style="margin-top:24px;display:flex;gap:12px;justify-content:center;align-items:center">
        <span class="badge lime" style="font-size:16px;padding:10px 20px">● Accepted</span>
        <span class="badge indigo" style="font-size:16px;padding:10px 20px">→ Draft order created</span></div>
        </div></div>""",
        sub=""))

    # 5 — AI order pad + reorder
    F.append(slide("#FBEEDD", "#FBF1E4", "F4 · F18 — Order pad",
        'Paste a list. <span class="hi">AI builds the cart</span>. Reorder in one tap.',
        """<div class="panel" style="width:520px">
        <div class="p-head"><span class="dot" style="background:#f5972d"></span><span class="p-title">Order pad</span></div>
        <div class="p-body">
        <div style="background:#1A1A2E;border-radius:14px;padding:20px;color:#e8e8f2;
        font-family:'DejaVu Sans Mono',monospace;font-size:17px;line-height:1.7">
        12× blue hoodie<br>6× SKU-4471<br>2 cases nitrile gloves M</div>
        <button class="btn primary" style="width:100%;margin-top:16px">✦ Build my cart</button>
        </div></div>
        <div style="font-size:44px;color:#4F46E5;font-weight:800">→</div>
        <div class="panel" style="width:520px">
        <div class="p-head"><span class="dot" style="background:#4F46E5"></span><span class="p-title">Cart · 3 lines</span>
        <span class="badge lime" style="margin-left:auto">Matched</span></div>
        <div class="p-body">
        <div class="row"><div class="l"><div class="thumb"></div><div><div class="lbl">Blue hoodie</div><div class="sub">12 × $18.00</div></div></div><span class="money">$216</span></div>
        <div class="row"><div class="l"><div class="thumb"></div><div><div class="lbl">SKU-4471</div><div class="sub">6 × $7.50</div></div></div><span class="money">$45</span></div>
        <div class="row"><div class="l"><div class="thumb"></div><div><div class="lbl">Nitrile gloves M</div><div class="sub">2 cases</div></div></div><span class="money">$184</span></div>
        </div></div>""",
        sub="Every AI-matched SKU is confirmed against your live catalog first."))

    # 6 — real shopify order on terms
    F.append(slide("#E4F1E8", "#EAF4EC", "F2 · F7 — Pipeline",
        'And it’s a real Shopify order — <span class="hi">on terms</span>.',
        """<div style="display:flex;gap:20px;align-items:flex-start">
        <div style="width:300px"><div class="ktitle">Quote sent</div>
        <div class="kcard"><div class="lbl" style="font-size:16px">Najd Wholesale</div><div class="sub">$1,240 · 3 days ago</div></div>
        <div class="kcard" style="opacity:.7"><div class="lbl" style="font-size:16px">Reef Trading</div><div class="sub">$860</div></div></div>
        <div style="width:300px"><div class="ktitle" style="color:#4F46E5">Accepted</div>
        <div class="kcard" style="border:1.5px solid #A3E635"><div class="lbl" style="font-size:16px">Gulf Medical</div><div class="sub">$438 · just now</div></div></div>
        <div style="width:340px"><div class="ktitle">Order · Shopify</div>
        <div class="kcard" style="border:1.5px solid #4F46E5">
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl" style="font-size:16px">#1042</span>
        <span class="badge indigo">Net 30</span></div>
        <div class="sub" style="margin-top:8px">Draft → order · terms attached</div>
        <div class="bar" style="width:100%;margin-top:14px;background:#EEF0FF"></div></div></div>
        </div>""",
        sub="Accepted quote → native Shopify order, on the payment terms you set."))

    # 7 — accounts, reps & insight
    F.append(slide("#EDE9FB", "#F0ECFB", "F5 · F12 · F7 · F8",
        'Company accounts, reps, and <span class="hi">win-rate insight</span>.',
        """<div class="panel" style="width:520px">
        <div class="p-head"><span class="dot" style="background:#4F46E5"></span><span class="p-title">Gulf Medical · Team</span></div>
        <div class="p-body">
        <div class="row"><div class="l"><div class="thumb" style="border-radius:50%"></div><div><div class="lbl">Sara — Buyer</div><div class="sub">can place orders</div></div></div><span class="badge indigo">Admin</span></div>
        <div class="row"><div class="l"><div class="thumb" style="border-radius:50%"></div><div><div class="lbl">Omar — Approver</div><div class="sub">approves > $1k</div></div></div><span class="badge ghost">Approver</span></div>
        <div class="row"><div class="l"><div class="thumb" style="border-radius:50%"></div><div><div class="lbl">Rep · Khalid</div><div class="sub">quotes for 12 accounts</div></div></div><span class="badge indigo">Rep</span></div>
        </div></div>
        <div style="width:520px;display:flex;flex-direction:column;gap:16px">
        <div class="panel" style="padding:24px 26px"><div class="ktitle">Win rate</div>
        <div class="stat">62<span class="u">%</span></div>
        <div class="sub" style="margin-top:6px">▲ up 9 pts this month</div></div>
        <div class="panel" style="padding:24px 26px;display:flex;justify-content:space-between;align-items:center">
        <div><div class="ktitle">Quote value</div><div class="stat" style="font-size:38px">$48<span class="u">k</span></div></div>
        <div><div class="ktitle">Follow-ups</div><div class="badge lime" style="font-size:15px">3 revived</div></div></div>
        </div>""",
        sub=""))

    # 8 — pricing ladder
    F.append(slide("#EAECFF", "#F3F1FB", "Pricing · flat fee",
        'B2B quotes, terms &amp; reorder — <span class="hi">on any plan</span>.',
        """<div style="display:flex;gap:18px;align-items:stretch;width:1180px">
        <div class="price"><h4>Free</h4><div class="amt"><span class="free">$0</span></div>
        <div class="sub" style="margin-top:10px">Get started</div></div>
        <div class="price"><h4>Starter</h4><div class="amt">$9<small>/mo</small></div>
        <div class="sub" style="margin-top:10px">Quotes + portal</div></div>
        <div class="price feat"><div class="badge indigo" style="margin-bottom:10px">Most popular</div>
        <h4>Growth</h4><div class="amt">$29<small>/mo</small></div>
        <div class="sub" style="margin-top:10px">AI, terms, analytics</div></div>
        <div class="price"><h4>Scale</h4><div class="amt">$69<small>/mo</small></div>
        <div class="sub" style="margin-top:10px">Reps, ERP, offers</div></div>
        </div>""",
        sub="Flat monthly fee — no per-order commission, ever."))

    # 9 — end card
    F.append(slide("#FBF8F4", "#FBF8F4", "",
        "", "",
        raw="""<div class="end">
        <div class="mark">M</div>
        <h1>Mannon</h1>
        <p>B2B quotes, terms &amp; reorder — on any plan.</p>
        <div class="s">Free plan · 14-day trial on paid · Built for Shopify</div>
        </div>""",
        stagex="display:none"))
    return F

# duration (seconds) per frame — reel stays <=60s (~46s rendered)
DUR = [4.5, 6.5, 5.5, 5.5, 6.0, 5.5, 6.0, 6.0, 5.0]
FPS = 30
XF = 0.6  # crossfade seconds

def render_frames(chrome):
    htmls = frames_def()
    pngs = []
    for i, html in enumerate(htmls, 1):
        hp = os.path.join(FRAMES, f"slide{i}.html")
        pp = os.path.join(PNG, f"slide{i}.png")
        with open(hp, "w") as f:
            f.write(html)
        subprocess.run([chrome, "--headless", "--no-sandbox", "--disable-gpu",
            "--hide-scrollbars", "--force-device-scale-factor=2",
            "--window-size=1600,900", f"--screenshot={pp}", f"file://{hp}"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pngs.append(pp)
        print(f"  rendered slide{i}.png")
    return pngs

def build_video(ff, pngs):
    n = len(pngs)
    # inputs: each PNG as a single still
    cmd = [ff, "-y"]
    for p in pngs:
        cmd += ["-i", p]
    # per-frame Ken-Burns (zoompan) — gentle zoom-in 1.00 -> 1.06, centered
    fc = []
    for i in range(n):
        N = int(round(DUR[i] * FPS))
        inc = 0.06 / N
        fc.append(
            f"[{i}:v]scale=2400:1350:force_original_aspect_ratio=increase,"
            f"crop=2400:1350,"
            f"zoompan=z='min(zoom+{inc:.6f},1.06)':d={N}:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps={FPS}:s=1600x900,"
            f"format=yuv420p,setsar=1[v{i}]"
        )
    # xfade chain
    prev = "v0"
    running = DUR[0]
    for i in range(1, n):
        off = running - XF
        out = f"x{i}" if i < n - 1 else "vout"
        fc.append(f"[{prev}][v{i}]xfade=transition=fade:duration={XF}:offset={off:.3f}[{out}]")
        running = running + DUR[i] - XF
        prev = out
    total = running
    filt = ";".join(fc)
    silent = os.path.join(HERE, "_silent.mp4")
    subprocess.run(cmd + ["-filter_complex", filt, "-map", "[vout]",
        "-r", str(FPS), "-c:v", "libx264", "-crf", "22", "-preset", "medium",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", silent],
        check=True)
    return silent, total

def build_bed(ff, total):
    """Soft synthesized ambient pad — a calm major chord, low, spacious."""
    bed = os.path.join(HERE, "_bed.m4a")
    T = total
    freqs = [261.63, 329.63, 392.00, 523.25]  # C E G C — major, calm
    cmd = [ff, "-y"]
    for fr in freqs:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency={fr}:duration={T:.3f}"]
    amix = "".join(f"[{i}]" for i in range(len(freqs)))
    af = (f"{amix}amix=inputs={len(freqs)}:normalize=0,volume=0.05,"
          f"aphaser=type=t:speed=0.28:decay=0.3,lowpass=f=1150,"
          f"aecho=0.8:0.85:70|120:0.25|0.18,"
          f"afade=t=in:st=0:d=2,afade=t=out:st={max(0,T-3):.3f}:d=3,"
          f"alimiter=limit=0.9")
    subprocess.run(cmd + ["-filter_complex", af, "-c:a", "aac", "-b:a", "128k", bed],
        check=True)
    return bed

def mux(ff, silent, bed):
    subprocess.run([ff, "-y", "-i", silent, "-i", bed,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
        "-movflags", "+faststart", OUT], check=True)

def main():
    ff = ffmpeg_exe()
    chrome = chrome_exe()
    print("Rendering 9 frames…")
    pngs = render_frames(chrome)
    print("Building Ken-Burns + crossfade video…")
    silent, total = build_video(ff, pngs)
    print(f"  video length ≈ {total:.1f}s")
    print("Synthesizing ambient bed…")
    bed = build_bed(ff, total)
    print("Muxing…")
    mux(ff, silent, bed)
    for tmp in (silent, bed):
        try: os.remove(tmp)
        except OSError: pass
    size = os.path.getsize(OUT) / 1e6
    print(f"\n✅ {OUT}  ·  {total:.1f}s  ·  {size:.1f} MB")

if __name__ == "__main__":
    main()
