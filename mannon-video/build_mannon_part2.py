#!/usr/bin/env python3
"""
Mannon — Part 2 extended-beat library (E6–E25).

One standalone 10–15s clip per feature for website / LinkedIn / regional ads.
Same pure pipeline as Part 1: branded HTML frame -> PNG (headless Chromium) ->
ffmpeg (Ken-Burns zoompan + short ambient bed, 1.5s in / 2s out). Social crops:
9:16 vertical for E16 / E18 / E23b, 16:9 for the rest.

Brand: indigo #4F46E5 · lime #A3E635 (fill only) · ink #1A1A2E · pastel tints.
Every caption/headline is ink or indigo (WCAG AA). Seeded demo data only
(Gulf Medical Supplies, Reef Trading, Najd Wholesale).

Run:  python3 build_mannon_part2.py            # all beats
      python3 build_mannon_part2.py E7 E25     # just those
"""
import os, subprocess, glob, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FR = os.path.join(HERE, "part2", "frames")
PNG = os.path.join(HERE, "part2", "png")
OUT = os.path.join(HERE, "part2")
for d in (FR, PNG, OUT):
    os.makedirs(d, exist_ok=True)

def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def chrome_exe():
    for p in glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"):
        return p
    raise RuntimeError("chromium not found")

FPS = 30
CHORDS = [[261.63,329.63,392.00,523.25],[293.66,349.23,440.00,587.33],
          [246.94,311.13,369.99,493.88]]

CSS = """
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:__W__px;height:__H__px;overflow:hidden}
body{font-family:'Inter','Cairo','Segoe UI',system-ui,'DejaVu Sans',sans-serif;
  color:#1A1A2E;position:relative;
  background:linear-gradient(135deg,__T1__ 0%,__T2__ 60%,#FBF8F4 100%)}
.stage{position:absolute;inset:0;padding:__PAD__;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px}
.mark{width:46px;height:46px;border-radius:12px;background:#4F46E5;color:#fff;
  font-weight:800;font-size:27px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 10px 24px rgba(79,70,229,.32)}
.word{font-weight:800;font-size:24px;letter-spacing:-.5px}
.eyebrow{margin-left:auto;font-weight:800;font-size:14px;letter-spacing:.14em;
  text-transform:uppercase;color:#4F46E5;opacity:.85}
.body{flex:1;display:flex;align-items:center;justify-content:center;gap:40px;
  padding-bottom:__BODYPB__px}
.body.col{flex-direction:column}
.caption{position:absolute;left:__PADX__px;right:__PADX__px;bottom:__CAPB__px}
.tick{display:inline-block;width:40px;height:6px;border-radius:6px;background:#4F46E5;margin-bottom:18px}
.cap-main{font-weight:800;font-size:__CAPSZ__px;line-height:1.08;letter-spacing:-1px;
  color:#1A1A2E;max-width:__CAPW__px}
.cap-main .hi{color:#4F46E5}
.cap-sub{margin-top:12px;font-weight:600;font-size:20px;color:#3a3a55;opacity:.92}
.rtl{direction:rtl;text-align:right}
.rtl .eyebrow,.rtl .caption{text-align:right}
/* components */
.panel{background:#fff;border-radius:22px;border:1px solid rgba(26,26,46,.06);
  box-shadow:0 30px 70px rgba(26,26,46,.15),0 3px 10px rgba(26,26,46,.05)}
.p-head{display:flex;align-items:center;gap:11px;padding:18px 24px;border-bottom:1px solid #EEF0F4}
.dot{width:11px;height:11px;border-radius:50%;background:#4F46E5}
.p-title{font-weight:700;font-size:18px;margin-left:4px}
.p-body{padding:22px 24px}
.row{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;
  border:1px solid #EEF0F4;border-radius:13px;margin-bottom:11px;background:#FCFCFE}
.row:last-child{margin-bottom:0}
.l{display:flex;align-items:center;gap:13px}
.thumb{width:40px;height:40px;border-radius:10px;background:#EEF0FF;flex:none}
.thumb.circ{border-radius:50%}
.lbl{font-weight:700;font-size:17px}
.sub{font-weight:600;font-size:13px;color:#8a8aa0}
.money{font-weight:800;font-size:18px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:999px;
  font-weight:700;font-size:13px}
.badge.indigo{background:#EEF0FF;color:#4F46E5}
.badge.lime{background:#A3E635;color:#1A1A2E}
.badge.ghost{background:#F3F4F8;color:#5b5b74}
.badge.green{background:#DCFCE7;color:#16794a}
.btn{padding:13px 24px;border-radius:12px;font-weight:800;font-size:17px;border:none}
.btn.primary{background:#4F46E5;color:#fff;box-shadow:0 10px 22px rgba(79,70,229,.3)}
.btn.lime{background:#A3E635;color:#1A1A2E}
.btn.wide{width:100%}
.hl{background:linear-gradient(120deg,#EEF0FF,#F6F0FF);border:1px solid #DAD8FF;
  border-radius:14px;padding:16px 18px}
.hl.green{background:#EAFBF1;border-color:#BEEFD3}
.tag{display:inline-flex;align-items:center;gap:7px;font-weight:800;font-size:13px;
  color:#4F46E5;letter-spacing:.04em;margin-bottom:8px}
.spark{width:18px;height:18px;border-radius:5px;background:#4F46E5;color:#fff;
  display:inline-flex;align-items:center;justify-content:center;font-size:12px}
.stat{font-weight:800;font-size:44px;letter-spacing:-1.5px;line-height:1}
.stat .u{font-size:22px;color:#4F46E5}
.ktitle{font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;
  color:#8a8aa0;margin-bottom:10px}
.bar{height:11px;border-radius:6px;background:#EAEAF2}
.phone{width:340px;height:700px;background:#1A1A2E;border-radius:44px;padding:13px;
  box-shadow:0 40px 90px rgba(26,26,46,.3);flex:none}
.screen{width:100%;height:100%;background:#FBF8F4;border-radius:33px;overflow:hidden;
  display:flex;flex-direction:column;padding:18px}
.notch{height:22px;display:flex;align-items:center;justify-content:center;margin-bottom:6px}
.notch i{width:96px;height:6px;border-radius:4px;background:#c9c9d6}
.pill{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;
  background:#EEF0FF;color:#4F46E5;font-weight:700;font-size:13px}
.kcard{background:#fff;border:1px solid #EEF0F4;border-radius:13px;padding:14px 16px;
  box-shadow:0 6px 16px rgba(26,26,46,.05)}
.chat{display:flex;flex-direction:column;gap:10px}
.msg{max-width:82%;padding:11px 14px;border-radius:16px;font-weight:600;font-size:14px}
.msg.in{background:#fff;border:1px solid #E8E8F0;align-self:flex-start;border-bottom-left-radius:4px}
.msg.out{background:#DCF8C6;align-self:flex-end;border-bottom-right-radius:4px}
.price{background:#fff;border-radius:16px;border:1px solid #EEF0F4;padding:16px;text-align:center;
  box-shadow:0 12px 28px rgba(26,26,46,.07)}
"""

SHELL = """<!doctype html><html><head><meta charset="utf-8"><style>__CSS__</style></head>
<body class="__BODYCLS__">__RAW__<div class="stage">
<div class="brand"><div class="mark">M</div><div class="word">Mannon</div>
<div class="eyebrow">__EYE__</div></div>
<div class="body __COL__">__CONTENT__</div>
<div class="caption"><span class="tick"></span>
<div class="cap-main">__CAP__</div>__SUB__</div>
</div></body></html>"""

# ---- tiny component helpers
def row(lbl, sub="", right="", circ=False):
    t = f'<div class="thumb{" circ" if circ else ""}"></div>'
    s = f'<div class="sub">{sub}</div>' if sub else ""
    r = f'<span class="money">{right}</span>' if right else ""
    return f'<div class="row"><div class="l">{t}<div><div class="lbl">{lbl}</div>{s}</div></div>{r}</div>'

def panel(title, inner, width="600px", tag=""):
    return (f'<div class="panel" style="width:{width}"><div class="p-head"><span class="dot"></span>'
            f'<span class="p-title">{title}</span>{tag}</div><div class="p-body">{inner}</div></div>')

def bdg(t, kind="indigo", ml=False):
    style = ' style="margin-left:auto"' if ml else ""
    return f'<span class="badge {kind}"{style}>{t}</span>'

# ---------------------------------------------------------------- beat catalog
def beats():
    B = []
    def add(**k): B.append(k)

    add(code="E6", eye="F6 · Registration", t1="#E9F1FB", t2="#EEF4FB", dur=11,
        cap='New buyers self-serve. <span class="hi">Auto-tagged, auto-priced.</span>',
        sub="",
        content=panel("Wholesale application",
            row("Reef Trading Co.", "reef@example.com · Trade licence ✓", bdg("Approved","green")) +
            row("Business type", "Distributor · 40 stores") +
            '<div class="hl" style="margin-top:4px"><div class="tag"><span class="spark">✦</span> On approval</div>'
            '<div class="lbl">Tagged <b>Wholesale</b> → Clinic price list + full catalog, instantly.</div></div>',
            width="820px"))

    add(code="E7", eye="F7 · Analytics ⚑", t1="#EDE9FB", t2="#F1ECFB", dur=13,
        cap='See every quote’s <span class="hi">win-rate and value.</span>', sub="",
        content='<div style="display:flex;gap:20px;align-items:stretch">'
            + panel("Win rate", '<div class="stat">62<span class="u">%</span></div>'
                    '<div class="sub" style="margin-top:8px">▲ 9 pts vs last month</div>'
                    '<div class="bar" style="width:62%;margin-top:16px;background:#4F46E5;height:12px"></div>', width="300px")
            + panel("Quote value", '<div class="stat">$248<span class="u">k</span></div>'
                    '<div class="sub" style="margin-top:8px">142 quotes · avg $1.7k</div>'
                    '<div class="bar" style="width:80%;margin-top:16px"></div>', width="300px")
            + panel("Time to close", '<div class="stat">2.4<span class="u">d</span></div>'
                    '<div class="sub" style="margin-top:8px">down from 6.1d</div>'
                    '<div class="bar" style="width:40%;margin-top:16px;background:#A3E635"></div>', width="300px")
            + '</div>')

    add(code="E8", eye="F8 · Follow-ups", t1="#FBEEE9", t2="#FBF1EC", dur=12,
        cap='Auto follow-ups — <span class="hi">no quote goes cold.</span>', sub="",
        content=panel("Reminder cadence · Quote #1042",
            row("Day 2 — gentle nudge", "sent · opened", bdg("Sent","ghost")) +
            row("Day 5 — expiry warning", "expires in 3 days", bdg("Queued","indigo")) +
            '<div class="hl green" style="margin-top:4px"><div class="tag" style="color:#16794a">'
            '<span class="spark" style="background:#16a34a">✓</span> Revived</div>'
            '<div class="lbl">Reef Trading reopened a cold quote → <b>$860 accepted.</b></div></div>',
            width="820px"))

    add(code="E9", eye="F9 · Order rules", t1="#E9F1EC", t2="#EEF4F0", dur=11,
        cap='Set MOQs and pack sizes. <span class="hi">Enforced automatically.</span>', sub="",
        content=panel("Cart · order rules",
            row("Nitrile gloves · M", "min 100 · pack of 50", bdg("240 ✓","green")) +
            row("Alcohol wipes", "min 24 · case of 12", bdg("Rounded → 24","indigo")) +
            '<div class="hl" style="margin-top:4px"><div class="lbl">Below MOQ? Checkout blocks it — '
            'with a plain-language fix, not an error.</div></div>', width="820px"))

    add(code="E10", eye="F10 · Accounting", t1="#E9F1FB", t2="#EEF3FA", dur=12,
        cap='Approved quotes <span class="hi">sync to your books.</span>', sub="",
        content=panel("Gulf Medical · $438", '<div style="display:flex;align-items:center;'
            'justify-content:space-between;gap:16px"><div class="lbl" style="font-size:20px">Quote accepted</div>'
            '<div style="font-size:34px;color:#4F46E5;font-weight:800">→</div>'
            '<div style="display:flex;gap:10px">' + bdg("QuickBooks ✓","green") + bdg("Xero ✓","green") + '</div></div>'
            '<div class="hl" style="margin-top:16px"><div class="lbl">Invoice INV-1042 created & reconciled — '
            'no double entry.</div></div>', width="820px"))

    add(code="E11", eye="F11 · Catalogs", t1="#EDE9FB", t2="#F1ECFA", dur=11,
        cap='Every buyer sees <span class="hi">their own catalog.</span>', sub="",
        content='<div style="display:flex;gap:24px">'
            + panel("Gulf Medical", row("Clinic assortment","82 SKUs · Clinic tier") + row("Nitrile, wipes, PPE",""), width="400px", tag=bdg("Catalog A","indigo",True))
            + panel("Najd Wholesale", row("Retail assortment","310 SKUs · Volume tier") + row("Apparel, home, bulk",""), width="400px", tag=bdg("Catalog B","ghost",True))
            + '</div>')

    add(code="E12", eye="F12 · Rep portal ⚑", t1="#E9EEFB", t2="#EEF2FB", dur=12,
        cap='Your reps <span class="hi">quote for their accounts.</span>', sub="",
        content=panel("Rep · Khalid — 12 accounts",
            row("Gulf Medical Supplies", "quote drafted · $438", bdg("Sent","indigo"), circ=True) +
            row("Reef Trading", "awaiting reply", bdg("Open","ghost"), circ=True) +
            row("Najd Wholesale", "won this week", bdg("Won","green"), circ=True), width="820px",
            tag=bdg("Leaderboard #2","lime",True)))

    add(code="E13", eye="F13 · Payments ⚑", t1="#EDF6DC", t2="#F1F7E6", dur=13,
        cap='Take deposits. Send a pay-link. <span class="hi">Get paid.</span>', sub="",
        content=panel("Order #1042 · $1,600",
            '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">'
            '<div class="price" style="flex:1"><div class="ktitle">Deposit</div>'
            '<div class="stat" style="font-size:32px">30%</div><div class="sub">$480 now</div></div>'
            '<div class="price" style="flex:1"><div class="ktitle">Balance</div>'
            '<div class="stat" style="font-size:32px">$1,120</div><div class="sub">on delivery</div></div></div>'
            '<button class="btn primary wide">Send pay-by-link</button>'
            '<div class="hl green" style="margin-top:12px"><div class="lbl">Paid via Shopify checkout — '
            'Mannon never touches card data.</div></div>', width="720px"))

    add(code="E14", eye="F14 · Tax / VAT", t1="#E9F1EC", t2="#EEF4EF", dur=11,
        cap='Tax-exempt buyers, <span class="hi">handled with the paperwork.</span>', sub="",
        content=panel("Gulf Medical · tax profile",
            row("Tax exemption", "certificate on file", bdg("Exempt ✓","green")) +
            row("VAT / GST", "reverse-charge · KSA 15%", bdg("Handled","indigo")) +
            '<div class="hl" style="margin-top:4px"><div class="lbl">Certificate stored, expiry tracked, '
            'compliant invoice numbering — automatic.</div></div>', width="820px"))

    add(code="E15", eye="F15 · ERP sync", t1="#E9EEFB", t2="#EEF2FB", dur=11,
        cap='Stock and pricing, <span class="hi">always in sync.</span>', sub="",
        content=panel("ERP · live feed",
            row("Nitrile gloves · M", "ERP on-hand 4,820", bdg("In stock","green")) +
            row("Exam couch roll", "ERP on-hand 0", bdg("Oversell guard","indigo")) +
            '<div class="hl" style="margin-top:4px"><div class="lbl">Inbound stock + outbound orders '
            'flow both ways — no manual re-keying.</div></div>', width="820px"))

    # --- E16 Arabic RTL (vertical)
    add(code="E16", eye="F16 · عربي", t1="#E9F1EC", t2="#EEF4F0", dur=13, vert=True, rtl=True,
        cap='<span dir="rtl">واجهة عربية كاملة، <span class="hi">بعملتك المحلية.</span></span>',
        sub='<span dir="rtl">Full Arabic UI · SAR / AED</span>',
        content='<div class="phone"><div class="screen" dir="rtl">'
            '<div class="notch"><i></i></div>'
            '<div class="pill">🔒 رابط آمن</div>'
            '<div style="margin-top:16px;font-weight:800;font-size:22px">عرض سعر #1042</div>'
            '<div class="sub" style="margin-top:4px">مؤسسة الخليج الطبية</div>'
            '<div class="kcard" style="margin-top:16px"><div style="display:flex;justify-content:space-between">'
            '<span class="lbl" style="font-size:16px">٣ أصناف</span><span class="money">١٬٦٤٠ ﷼</span></div>'
            '<div class="bar" style="width:78%;margin-top:12px"></div>'
            '<div class="bar" style="width:55%;margin-top:9px"></div></div>'
            '<button class="btn primary wide" style="margin-top:16px">مراجعة وقبول</button>'
            '<div style="margin-top:14px;display:flex;gap:8px"><span class="badge lime">● مقبول</span>'
            '<span class="badge indigo">﷼ SAR</span></div>'
            '</div></div>')

    add(code="E17", eye="F17 · Widget", t1="#E9EEFB", t2="#EEF2FB", dur=11,
        cap='Turn any product page into <span class="hi">a quote request.</span>', sub="",
        content=panel("Storefront · product page",
            '<div style="display:flex;gap:16px;align-items:center;margin-bottom:14px">'
            '<div class="thumb" style="width:90px;height:90px;border-radius:14px"></div>'
            '<div><div class="lbl" style="font-size:20px">Bulk nitrile gloves</div>'
            '<div class="sub">Price hidden · trade pricing</div></div></div>'
            '<button class="btn primary wide">Request a Quote</button>'
            '<div class="hl" style="margin-top:12px"><div class="lbl">Form submits straight into your '
            'Mannon inbox — tagged by product.</div></div>', width="720px"))

    # --- E18 buyer app (vertical)
    add(code="E18", eye="F18 · Buyer app ⚑", t1="#EDE9FB", t2="#F1ECFB", dur=14, vert=True,
        cap='Your buyers get an app. <span class="hi">Reorder in one tap.</span>', sub="",
        content='<div class="phone"><div class="screen">'
            '<div class="notch"><i></i></div>'
            '<div class="brand" style="gap:9px"><div class="mark" style="width:30px;height:30px;font-size:18px;border-radius:8px">M</div>'
            '<div class="word" style="font-size:16px">Mannon</div><span class="pill" style="margin-left:auto">Installed</span></div>'
            '<div class="hl" style="margin-top:14px;padding:12px 14px"><div class="tag"><span class="spark">🔔</span> Time to reorder?</div>'
            '<div class="lbl" style="font-size:15px">Your gloves usually run out about now.</div></div>'
            '<div class="ktitle" style="margin-top:16px">Saved bundle</div>'
            '<div class="kcard"><div class="lbl" style="font-size:16px">Clinic monthly · 6 items</div>'
            '<div class="sub" style="margin-top:2px">last ordered 28 days ago</div></div>'
            '<button class="btn lime wide" style="margin-top:14px">↻ Reorder in one tap</button>'
            '</div></div>')

    add(code="E19", eye="F19 · Sharing", t1="#E9F1FB", t2="#EEF3FA", dur=11,
        cap='Share a catalog. <span class="hi">Win a new buyer.</span>', sub="",
        content=panel("Public catalog link",
            '<div class="pill" style="margin-bottom:14px">🔗 mannon.app/c/najd-wholesale</div>' +
            row("Preview · 310 SKUs", "no login required") +
            '<div class="hl" style="margin-top:4px"><div class="tag"><span class="spark">✦</span> New lead</div>'
            '<div class="lbl">A recipient requested access → lands in your pipeline.</div></div>', width="820px"))

    add(code="E20", eye="F20 · Agency", t1="#EDE9FB", t2="#F1ECFA", dur=12,
        cap='Run it for every client, <span class="hi">under your brand.</span>', sub="",
        content='<div style="display:flex;gap:22px">'
            + panel("Store A · Reef", row("Brand: Reef","white-label portal") + row("42 buyers",""), width="380px", tag=bdg("Client","indigo",True))
            + panel("Store B · Najd", row("Brand: Najd","white-label portal") + row("120 buyers",""), width="380px", tag=bdg("Client","ghost",True))
            + '</div>')

    add(code="E21", eye="F21 · Make an Offer ⚑", t1="#EDF6DC", t2="#F1F7E6", dur=14,
        cap='Let buyers make an offer — <span class="hi">AI counters, your margin’s safe.</span>', sub="",
        content=panel("Offer · Reef Trading",
            row("Buyer offers", "500 units @ $0.34", bdg("Below floor","ghost")) +
            '<div class="hl" style="margin-top:4px"><div class="tag"><span class="spark">✦</span> Auto counter</div>'
            '<div style="display:flex;align-items:center;justify-content:space-between">'
            '<div class="lbl" style="font-size:18px">Counter <b>$0.38</b> · margin floor held at <b>28%</b></div>'
            '<span class="badge lime">Deal closed</span></div></div>', width="820px"))

    add(code="E23a", eye="F23.1 · CRM", t1="#E9EEFB", t2="#EEF2FB", dur=10,
        cap='Every quote lands in <span class="hi">your CRM.</span>', sub="",
        content=panel("New quote · Gulf Medical",
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px">'
            '<div class="lbl" style="font-size:19px">Quote #1042 created</div>'
            '<div style="font-size:30px;color:#4F46E5;font-weight:800">→</div>'
            '<div style="display:flex;gap:10px">' + bdg("HubSpot ✓","green") + bdg("Mailchimp ✓","green") + '</div></div>'
            '<div class="hl" style="margin-top:14px"><div class="lbl">Contact + deal pushed automatically — '
            'your pipeline stays whole.</div></div>', width="820px"))

    # --- E23b WhatsApp (vertical)
    add(code="E23b", eye="F23.2 · WhatsApp ⚑", t1="#E9F1EC", t2="#EEF4EF", dur=13, vert=True,
        cap='Quote and close <span class="hi">on WhatsApp.</span>', sub="",
        content='<div class="phone"><div class="screen" style="background:#E5DDD5">'
            '<div class="notch"><i></i></div>'
            '<div style="background:#075E54;margin:-18px -18px 12px;padding:14px 16px;color:#fff;'
            'font-weight:700;display:flex;align-items:center;gap:10px"><div class="thumb circ" style="width:32px;height:32px;background:#25D366"></div>Gulf Medical Supplies</div>'
            '<div class="chat">'
            '<div class="msg in">Hi! Can you quote 240 gloves + wipes?</div>'
            '<div class="msg out"><b>Quote #1042</b><br>2 items · <b>$438.00</b><br>Reply YES to accept ✅</div>'
            '<div class="msg in" style="background:#DCF8C6">YES ✅</div>'
            '<div class="msg out">Accepted 🎉 draft order created.</div>'
            '</div>'
            '<div style="margin-top:auto;padding-top:10px"><span class="badge indigo">↔ Mirrored into Mannon</span></div>'
            '</div></div>')

    add(code="E23c", eye="F23.3 · Chat", t1="#E9EEFB", t2="#EEF2FB", dur=10,
        cap='Negotiate <span class="hi">right inside the quote.</span>', sub="",
        content=panel("Quote #1042 · thread",
            '<div class="chat" style="gap:12px">'
            '<div class="msg in" style="max-width:70%">Any flex on the wipes?</div>'
            '<div class="msg" style="max-width:70%;background:#EEF0FF;align-self:flex-end;color:#1A1A2E">'
            'Can do $2.90 if you take 200.</div>'
            '<div class="msg in" style="max-width:70%">Deal 👍</div></div>'
            '<div class="hl" style="margin-top:14px"><div class="lbl">No email ping-pong — every message '
            'stays attached to the quote.</div></div>', width="720px"))

    add(code="E23d", eye="F23.4/5 · Scoring", t1="#EDE9FB", t2="#F1ECFA", dur=12,
        cap='Know where quotes come from — <span class="hi">and which will close.</span>', sub="",
        content=panel("Inbox · scored",
            row("Gulf Medical", "source: WhatsApp", bdg("92 · hot","lime")) +
            row("Reef Trading", "source: widget", bdg("74 · warm","indigo")) +
            row("Unknown sender", "source: duplicate", bdg("Spam?","ghost")), width="820px"))

    add(code="E24", eye="F24 · Capture ⚑", t1="#E9F1FB", t2="#EEF3FA", dur=14,
        cap='Capture quotes <span class="hi">anywhere on your storefront.</span>', sub="",
        content='<div style="display:flex;gap:20px">'
            + panel("Form builder", row("Company name","required") + row("Target price","optional") + row("Upload PO","file"), width="380px", tag=bdg("Drag & build","indigo",True))
            + panel("On storefront", '<div class="pill" style="margin-bottom:12px">Logged-out → price hidden</div>'
                    + row("Add to Quote","across pages", bdg("3 items","indigo"))
                    + row("Cart → Quote","one click", bdg("Convert","lime")), width="380px")
            + '</div>')

    add(code="E25", eye="F25 · Quote Ops ⚑", t1="#EDE9FB", t2="#F1ECFB", dur=14,
        cap='From quote request to closed deal — <span class="hi">in one click.</span>', sub="",
        content='<div style="display:flex;gap:20px;align-items:center">'
            + panel("Quote #1042", row("Branded PDF","download · resend", bdg("PDF","indigo")) + row("Create similar","duplicate", bdg("Copy","ghost")), width="380px")
            + '<div style="font-size:38px;color:#4F46E5;font-weight:800">→</div>'
            + panel("One click", '<button class="btn primary wide" style="margin-bottom:12px">Convert → draft order</button>'
                    + row("Invoice sent","at agreed price", bdg("Done ✓","green")), width="380px")
            + '</div>')

    return B

def render(chrome, b):
    vert = b.get("vert", False)
    W, H = (900, 1600) if vert else (1600, 900)
    pad = "56px 60px" if vert else "70px 88px"
    padx = 60 if vert else 88
    capb = 96 if vert else 92
    capsz = 40 if vert else 44
    capw = 780 if vert else 1180
    bodypb = 60 if vert else 168
    css = (CSS.replace("__W__", str(W)).replace("__H__", str(H))
           .replace("__T1__", b["t1"]).replace("__T2__", b["t2"])
           .replace("__PAD__", pad).replace("__PADX__", str(padx))
           .replace("__CAPB__", str(capb)).replace("__CAPSZ__", str(capsz))
           .replace("__CAPW__", str(capw)).replace("__BODYPB__", str(bodypb)))
    sub = f'<div class="cap-sub">{b["sub"]}</div>' if b.get("sub") else ""
    html = (SHELL.replace("__CSS__", css)
            .replace("__BODYCLS__", "rtl" if b.get("rtl") else "")
            .replace("__RAW__", b.get("raw", ""))
            .replace("__EYE__", b["eye"]).replace("__COL__", "col" if vert else "")
            .replace("__CONTENT__", b["content"]).replace("__CAP__", b["cap"])
            .replace("__SUB__", sub))
    hp = os.path.join(FR, f"{b['code']}.html")
    pp = os.path.join(PNG, f"{b['code']}.png")
    open(hp, "w").write(html)
    subprocess.run([chrome, "--headless", "--no-sandbox", "--disable-gpu",
        "--hide-scrollbars", "--force-device-scale-factor=2",
        f"--window-size={W},{H}", f"--screenshot={pp}", f"file://{hp}"],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return pp, W, H

def build_clip(ff, png, dur, W, H, out, chord):
    N = int(round(dur * FPS)); inc = 0.05 / N
    T = dur
    cmd = [ff, "-y", "-i", png]
    for fr in chord:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency={fr}:duration={T:.3f}"]
    amix = "".join(f"[{i+1}]" for i in range(len(chord)))
    vf = (f"[0:v]scale={W*3//2}:{H*3//2}:force_original_aspect_ratio=increase,"
          f"crop={W*3//2}:{H*3//2},zoompan=z='min(zoom+{inc:.6f},1.05)':d={N}:"
          f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps={FPS}:s={W}x{H},"
          f"format=yuv420p,setsar=1[v]")
    af = (f"{amix}amix=inputs={len(chord)}:normalize=0,volume=0.05,"
          f"aphaser=type=t:speed=0.28:decay=0.3,lowpass=f=1150,"
          f"aecho=0.8:0.85:70|120:0.25|0.18,"
          f"afade=t=in:st=0:d=1.5,afade=t=out:st={max(0,T-2):.3f}:d=2,"
          f"alimiter=limit=0.9[a]")
    subprocess.run(cmd + ["-filter_complex", vf + ";" + af, "-map", "[v]", "-map", "[a]",
        "-r", str(FPS), "-c:v", "libx264", "-crf", "22", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-t", f"{T:.3f}",
        "-movflags", "+faststart", out],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def main():
    ff = ffmpeg_exe(); chrome = chrome_exe()
    want = set(a.upper() for a in sys.argv[1:])
    allb = beats()
    sel = [b for b in allb if not want or b["code"].upper() in want]
    print(f"Building {len(sel)} extended beats…\n")
    total_mb = 0.0
    for i, b in enumerate(sel):
        pp, W, H = render(chrome, b)
        out = os.path.join(OUT, f"{b['code']}.mp4")
        build_clip(ff, pp, b["dur"], W, H, out, CHORDS[i % len(CHORDS)])
        mb = os.path.getsize(out) / 1e6; total_mb += mb
        orient = "9:16" if b.get("vert") else "16:9"
        print(f"  ✅ {b['code']:5s} {orient} {b['dur']:.0f}s {mb:4.1f}MB  ·  {b['cap'][:52].replace(chr(60),'').split('.')[0]}…")
    print(f"\nDone — {len(sel)} clips · {total_mb:.1f} MB total · in {OUT}")

if __name__ == "__main__":
    main()
