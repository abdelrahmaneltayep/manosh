# Mannon brand guide

Portable branding for Mannon and any sibling app. Everything here is lifted from the shipped
surfaces (landing page, buyer portal, public demo, App Store slides and screencast), so a new app
that follows this file will look like it came from the same family.

Scope rule first: **inside the Shopify admin we use Polaris and nothing else.** The Mannon brand
lives on the surfaces we own: landing page, buyer portal, demo hub, emails, listing assets. The
embedded admin app carries only the app name and icon.

---

## 1. Identity

| Item | Value |
|---|---|
| Name | **Mannon** (always capital M, never "MANNON" or "mannon" in prose; the wordmark is lowercase) |
| Repo / host | `manosh` · `manosh.fly.dev` (infrastructure names, never customer-facing) |
| One-liner | Quote, counter with Claude, and reorder in one tap. The B2B buying workflow your store is missing. |
| Card subtitle | B2B quotes and counters with Claude, plus one-tap reorder |
| Listing name | Mannon — B2B Quotes & Reorders |
| Recurring line | Built on Shopify's native B2B — every price comes from Shopify. |
| Portal tag | Wholesale portal · بوابة الجملة · Portail de gros |

The recurring line appears once on every marketing surface (landing accent, last slide, screencast
close, App details). It is the trust promise: we never compute money.

---

## 2. Logo

### Wordmark

Lowercase **mannon** in the system sans at weight 800, letter-spacing −0.02em, preceded by the
mark. The mark is a capital **M** in indigo, weight 900, with a lime dot tucked at its bottom right.
The dot is the brand's signature; never drop it, never recolor it.

```html
<span class="brand"><span class="mark">M<span class="dot"></span></span>mannon</span>
```

```css
.brand { display:inline-flex; align-items:center; gap:.45em; font-weight:800; letter-spacing:-.02em; color:var(--ink); }
.mark  { position:relative; color:var(--indigo); font-weight:900; font-size:1.2em; line-height:1; }
.dot   { position:absolute; right:-.3em; bottom:.06em; width:.3em; height:.3em; border-radius:50%; background:var(--lime); }
```

Sizes in use: landing 1.9rem wordmark / 2.1rem mark; portal 1.2rem / 1.45rem; header bars 22px / 26px.

### App icon (1200 × 1200)

Rounded square (radius ≈ 18%) on a soft diagonal gradient from lavender `#ecebff` (top left) to a
warm off-white `#fbf3ec` (bottom right). Centered rounded-stroke **M** in the indigo gradient
`#5b4bf0 → #4f46e5`, stroke ≈ 12% of the canvas with round caps and joins. Lime dot `#a3e635 →
#84cc16` at the M's bottom-right foot, diameter ≈ 13% of the canvas, slightly overlapping the
stroke. Source file: `public/mannon-app-icon-1200.png`. Favicon is the same mark at 32 px.

Drop-in SVG of the mark (scales to any size):

```svg
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mannon">
  <defs>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5b4bf0"/><stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
    <linearGradient id="lime" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a3e635"/><stop offset="1" stop-color="#84cc16"/>
    </linearGradient>
  </defs>
  <path d="M32 92V40l28 32 28-32v52" fill="none" stroke="url(#ink)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="92" cy="86" r="10" fill="url(#lime)"/>
</svg>
```

Rules: minimum clear space equals the dot's diameter on all sides; never place the mark on
indigo (use the white wordmark variant instead: mark white, dot lime); never add a shadow,
outline or gradient to the wordmark text.

---

## 3. Color

### Core tokens

| Token | Hex | Use |
|---|---|---|
| `--indigo` | `#4f46e5` | Primary actions, mark, links on dark, focus rings |
| `--indigo-ink` | `#4338ca` | Links on light backgrounds, hover state of indigo |
| `--indigo-2` | `#5b4bf0` | Gradient top, purple header bars in white-label demos |
| `--lime` | `#84cc16` | The dot, success actions ("Accept quote"), confirmations |
| `--ink` | `#1c1d2b` | Body text, headings |
| `--sub` | `#5b5f6e` | Secondary text (landing uses `#6b7280`) |
| `--line` | `#e6e6ef` | Borders, dividers, table rules |
| `--bg` | `#f6f5ff` | Page background on brand surfaces (portal, demo) |
| `--surface` | `#ffffff` | Cards |
| `--chip` | `#eef0ff` | Tinted chips, Net-terms badges, selected states |
| `--danger` | `#8e1f0b` | Error text |

### Status pills

| Status | Background | Text |
|---|---|---|
| New / Submitted | `#fff1e3` | `#8a6116` |
| Countered | `#eef0ff` | `#3730a3` |
| Accepted / Ordered | `#e3f5ec` | `#0f6848` |
| Expired / Cancelled | `#eeeeee` | `#616161` |

### Slide tints (listing screenshots)

Warm, low-saturation washes so the white product cards pop: lavender `#eef0ff`, pink `#fbeef0`,
green `#eaf6ee`, violet `#f1ecff`, amber `#fff4e5`, and one hero slide on solid indigo with white
type. Never more than one tint per slide, always with a large soft "blob" circle at 8% opacity.

### Ready-to-paste `:root`

```css
:root {
  --indigo:#4f46e5; --indigo-ink:#4338ca; --indigo-2:#5b4bf0; --lime:#84cc16;
  --ink:#1c1d2b; --sub:#5b5f6e; --line:#e6e6ef; --bg:#f6f5ff; --surface:#fff;
  --chip:#eef0ff; --danger:#8e1f0b;
  --accent:var(--indigo); --accent-text:#fff; --link:var(--indigo-ink);
}
```

White-label surfaces override only `--accent`, `--accent-text`, `--link` and `--lime` at runtime.
Everything else stays.

Contrast: ink on bg and surface passes AAA. Indigo on white passes AA for text. Lime is never used
for text; it is a fill with ink (`#1c1d2b`) text on top.

---

## 4. Typography

System stack, no web font to load:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif;
-webkit-font-smoothing: antialiased;
```

| Role | Size | Weight | Notes |
|---|---|---|---|
| Display (landing h1, slide h1) | 44–64px | 800 | letter-spacing −0.02em, line-height 1.05; highlight one phrase in indigo |
| Page title (portal h1) | 28–30px | 800 | |
| Section heading | 18–19px | 800 | |
| Body | 16–17px | 400 | line-height 1.5 |
| Meta / muted | 14–15px | 400–600 | `--sub` |
| Kicker / eyebrow | 13px | 800 | uppercase, letter-spacing 0.06em, indigo |
| Button | 15–17px | 800 | |

Arabic: same stack (system Arabic fonts), `dir="rtl"`, mirror paddings and the mark stays on the
reading-start side.

---

## 5. Shape, space, elevation

- Radius: buttons and inputs 9–12px, cards 16px, pills 999px, browser and phone mocks 20px+.
- Spacing scale: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- Card: white surface, 1px `--line` border or shadow `0 20px 60px rgba(28,29,43,.10)`, padding 32–40px desktop and 20px mobile.
- Content width: 900px portal card, 1100px landing.
- Focus ring: 2px `--indigo` outline, 2px offset, on every interactive element.

---

## 6. Components (non-Polaris surfaces)

**Primary button** — indigo fill, white text, weight 800, radius 9–12px, padding 10×18 (sm) or 14×24.
**Secondary / ghost** — white fill, 1px `--line` border, ink text; on indigo backgrounds use a white 1px outline.
**Success button** — lime fill, ink text (used for the single most important buyer action, e.g. Accept quote).
**Text link** — `--link`, weight 800 on brand surfaces, underline with 3px offset.
**List row** — flex, 14–15px vertical padding, 1px top rule except the first row, primary label bold, meta in `--sub`, action on the right.
**Banner** — chip background `#eef2ff`, 1px `#c7d2fe` border, radius 10px, bold lead-in ("Demo portal.").
**Toast** — ink background, white bold text, radius 10px, bottom center.
**Header bar** — white with 1px bottom rule and the mark + wordmark; white-label portals may use a solid `--indigo-2` bar with white text.

Inside the Shopify admin: Polaris only. Page, Card, Banner, Badge, IndexTable, Button. No brand colors.

---

## 7. Voice and copy

Calm, confident product owner. Plain language, benefit first, honest about limits. Polaris content
guidelines apply everywhere, not just in the admin.

- Sentence case for everything, including buttons and headings.
- Lead with the merchant's outcome, then the mechanism: "Accepting turns the quote into a Shopify draft order."
- Say **Shopify draft order**, **net terms**, **buyer portal**, **one-tap reorder**, **quote request**. Avoid "leads", "deals", "checkout" for B2B flows.
- The AI is **Claude**, always with the ✦ glyph on controls: "✦ Draft with Claude". The rule appears wherever Claude does: *Claude drafts, you review and send. It never acts on its own.*
- No pricing outside the Pricing section. No statistics, guarantees, superlatives or testimonials in listing copy or images.
- Money is never ours: write "priced by Shopify", "tax and total from Shopify", "re-priced live by Shopify".
- Dates as "Sep 19, 2026". Money as the currency code and Shopify's amount: "USD 1286.40".
- Punctuation: en dashes with spaces only in marketing copy, none in UI labels. The interpunct " · " separates meta items.

Reusable lines:

- Quote, counter with Claude, and reorder in one tap.
- Wholesale quoting, without the email grind.
- Try before you install. No install, no sign-up.
- Passwordless buyer portal — no account, no password to accept or reorder.

---

## 8. Motion and media

- Transitions 150–250ms ease on hover and focus; nothing bounces.
- Screencast: 1920×1080 30fps, 0.4–0.5s cross-fades, 2% slow zoom per scene, dark rounded lower-third captions, indigo click ripple, soft pad music around −22 LUFS under voice.
- Screenshots: 1600×900 exported at 2× (3200×1800), one feature per slide, mark top-left, pill footer with a colored dot and the slide number, no pricing, no browser chrome from a real browser.
- Photos and illustrations: none. The product UI is the imagery.

---

## 9. Naming things in a new app

- Package and repo names stay lowercase and short (`manosh` pattern). Customer-facing name gets the capital.
- Feature names are plain nouns: Quote inbox, Order pad, Reorder cards, Price lists. No trademarks, no "Pro"/"AI" suffixes.
- Environment flags are `MANNON_FF_<FEATURE>`; brand tokens are the CSS custom properties above; white-label overrides are `--accent`, `--accent-text`, `--link`, `--lime`.

---

## 10. Checklist for a new surface

- [ ] Mark + wordmark top-left, dot present, clear space respected.
- [ ] `:root` tokens pasted, no hard-coded hex outside this file's list.
- [ ] System font stack, weights 400/600/800/900 only.
- [ ] One indigo primary action per view, lime reserved for the single confirming action.
- [ ] Status pills use the table above.
- [ ] Copy in sentence case, Claude rule present wherever Claude is, money attributed to Shopify.
- [ ] Focus rings visible, AA contrast, keyboard reachable, RTL checked if Arabic is offered.
- [ ] Admin screens: Polaris only.
