# Mannon — Part 2 extended-beat library (E6–E25)

Standalone 10–15s clips, one per feature, for website / LinkedIn / regional ads.
Built by `../build_mannon_part2.py` (branded HTML frame → PNG via headless Chromium
→ ffmpeg Ken-Burns zoompan + soft ambient bed, 1.5s in / 2s out). Cut into a longer
website film or post individually. ⚑ = strongest social clip.

Brand: indigo `#4F46E5` · lime `#A3E635` (fill only) · ink `#1A1A2E` · pastel tints.
Every caption is ink or indigo (WCAG AA). Seeded demo data only.

| Clip | Feature | Crop | Len | Caption |
|---|---|---|---|---|
| `E6.mp4`   | F6 Wholesale registration | 16:9 | 11s | New buyers self-serve. Auto-tagged, auto-priced. |
| `E7.mp4` ⚑ | F7 Quote analytics | 16:9 | 13s | See every quote's win-rate and value. |
| `E8.mp4`   | F8 Follow-ups & expiry | 16:9 | 12s | Auto follow-ups — no quote goes cold. |
| `E9.mp4`   | F9 MOQ & pack rules | 16:9 | 11s | Set MOQs and pack sizes. Enforced automatically. |
| `E10.mp4`  | F10 Accounting sync | 16:9 | 12s | Approved quotes sync to your books. |
| `E11.mp4`  | F11 Custom catalogs | 16:9 | 11s | Every buyer sees their own catalog. |
| `E12.mp4` ⚑ | F12 Sales-rep portal | 16:9 | 12s | Your reps quote for their accounts. |
| `E13.mp4` ⚑ | F13 Deposits & pay-by-link | 16:9 | 13s | Take deposits. Send a pay-link. Get paid. |
| `E14.mp4`  | F14 Tax exemption & VAT/GST | 16:9 | 11s | Tax-exempt buyers, handled with the paperwork. |
| `E15.mp4`  | F15 ERP / inventory sync | 16:9 | 11s | Stock and pricing, always in sync. |
| `E16.mp4` ⚑ | F16 Arabic / RTL | **9:16** | 13s | واجهة عربية كاملة، بعملتك المحلية. |
| `E17.mp4`  | F17 Request-a-Quote widget | 16:9 | 11s | Turn any product page into a quote request. |
| `E18.mp4` ⚑ | F18 Installable buyer app | **9:16** | 14s | Your buyers get an app. Reorder in one tap. |
| `E19.mp4`  | F19 Catalog sharing | 16:9 | 11s | Share a catalog. Win a new buyer. |
| `E20.mp4`  | F20 White-label / agency | 16:9 | 12s | Run it for every client, under your brand. |
| `E21.mp4` ⚑ | F21 Make an Offer | 16:9 | 14s | Let buyers make an offer — AI counters, your margin's safe. |
| `E23a.mp4` | F23.1 CRM & email | 16:9 | 10s | Every quote lands in your CRM. |
| `E23b.mp4` ⚑ | F23.2 WhatsApp quotes | **9:16** | 13s | Quote and close on WhatsApp. |
| `E23c.mp4` | F23.3 In-quote chat | 16:9 | 10s | Negotiate right inside the quote. |
| `E23d.mp4` | F23.4/5 Source tracking + AI lead scoring | 16:9 | 12s | Know where quotes come from — and which will close. |
| `E24.mp4` ⚑ | F24 Storefront Quote Capture Suite | 16:9 | 14s | Capture quotes anywhere on your storefront. |
| `E25.mp4` ⚑ | F25 Quote Ops & Conversion | 16:9 | 14s | From quote request to closed deal — in one click. |

**Regenerate:** `python3 ../build_mannon_part2.py` (all) or `python3 ../build_mannon_part2.py E7 E25` (subset).

Part 1 core reel (≤60s listing cut) is `../mannon-demo.mp4`, built by `../build_mannon_video.py`.
