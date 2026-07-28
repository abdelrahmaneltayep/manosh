# Mannon — App Store Submission Checklist

Paste-ready mapping of each copy block + asset to its **Shopify Partner
Dashboard** field. Source of truth for text is `Mannon-Listing-Copy.md`; assets
are in `rendered/`. Character counts validated against Shopify limits.

> ⚠️ **Read the "Blockers & flags" section at the bottom before submitting** —
> there are placeholder URLs and a pricing/feature mismatch between the listing
> copy and the shipped app that must be reconciled first.

---

## 1. App listing → Dashboard fields

| Dashboard field | Value | Limit | Count |
|---|---|---|---|
| **App name** | `Mannon: B2B Quotes & Terms` | ≤30 | **26 ✓** |
| App name (fallback) | `Mannon B2B Quotes` | ≤30 | 17 ✓ |
| **Tagline / subtitle** | `Send B2B quotes, get paid on terms — on any Shopify plan.` | ≤62 | **57 ✓** |
| Tagline alt 1 | `Quotes, reorders & net terms for B2B — on any plan.` | ≤62 | 51 ✓ |
| Tagline alt 2 | `B2B quotes buyers accept themselves. No login needed.` | ≤62 | 53 ✓ |
| **App introduction** | Intro paragraph from `Mannon-Listing-Copy.md` (§ Intro paragraph) | ~500 shown | ✓ |
| **Detailed description** | Full description from `Mannon-Listing-Copy.md` (§ Full description) | — | ✓ |
| **Key benefits (×3)** | The 3 benefit cards (§ Key benefit cards) | 3 cards | ✓ |
| **Search terms** | `b2b`, `wholesale`, `quotes`, `net terms`, `reorder` (strongest 5) | 5 | ✓ |

All copy is within Shopify's character limits — nothing over.

## 2. Assets → Dashboard fields

| Dashboard field | File (`store/listing/rendered/`) | Dimensions | Notes |
|---|---|---|---|
| **App icon** | `app-icon-1200.png` | 1200×1200 | Uploaded via Dashboard (no `shopify.app.toml` field). Also in `public/mannon-app-icon-1200.png`. |
| App icon (small) | `app-icon-512.png` | 512×512 | Optional smaller variant |
| Favicon | `favicon-32.png` | 32×32 | Wired into the app at `public/favicon-32.png` (referenced in `app/root.tsx`) |
| **Screenshot 1** | `screenshot-1.png` | 3200×1800 | Quote builder — priced by Shopify |
| **Screenshot 2** | `screenshot-2.png` | 3200×1800 | Passwordless buyer portal |
| **Screenshot 3** | `screenshot-3.png` | 3200×1800 | AI Magic Order Pad |
| **Screenshot 4** | `screenshot-4.png` | 3200×1800 | Quote pipeline (sent→ordered) |
| **Screenshot 5** | `screenshot-5.png` | 3200×1800 | Native net terms |
| Brand review sheet | `logo-preview.png` | 2240×2862 | Internal reference (not submitted) |
| **Demo video (public listing)** | `Mannon-Demo-Video.mp4` | 1920×1080 · 78s · 5 MB | Within Shopify limits (≤30 MB, 1080p, 60–90s) |
| **Reviewer demo video (App Review)** | record per `Mannon-Reviewer-Demo-Script.md` | 1080p · ~7–9 min | Covers all 20 shipped features (F1–F20) + how to reach the gated ones. NOT the public reel. |

> Screenshots are rendered at **3200×1800** (the 1600×900 design at deviceScaleFactor 2).
> This exceeds Shopify's 1600×900 minimum at the exact 16:9 ratio. If you specifically
> need exactly 1600×900 files, say so and I'll re-export at 1× — but larger is accepted.

## 3. Pricing → Dashboard fields

- **Starter — $29/mo**, **Growth — $79/mo**, **14-day free trial** on both.
  (Prices match the shipped billing config; see the plan-contents flag below.)

## 4. Compliance (set in Dashboard / verified in code)

- Privacy policy URL → **the app ships a live page at `/privacy`** (route
  `app/routes/privacy.tsx`). Set it to `https://<your-app-domain>/privacy`.
- Minimum scopes, 3 GDPR webhooks + `app/uninstalled`, HMAC-verified — all in
  place (see `docs/compliance.md`, `docs/self-review.md`). Screenshots use
  realistic data (Cedar & Co., real SKUs, VAT 15%), not lorem.

---

## Blockers & flags — resolve before submitting

### 🚩 Placeholder links (fill in `Mannon-Listing-Copy.md` § Support & links)
- **Support email** — still `______`. Required by Shopify.
- **Demo store URL** — still `______`. Reviewers need a working test store.
- **FAQ / docs URL** — still `______` (optional but recommended).
- **Privacy policy URL** — page exists at `/privacy`; the **domain** is still a
  placeholder (`application_url` in `shopify.app.toml` = `https://example.com`).
  Set the real deployed domain.

### 🚩 Listing copy vs. shipped app — pricing/feature split does not match
`Mannon-Listing-Copy.md` describes plan contents that differ from what the app
actually gates (`app/lib/billing.ts` → `GROWTH_FEATURES`, and the shipped routes):

| Listing copy claims | What the app actually ships |
|---|---|
| Starter: "Up to 50 active quotes/mo" | **No quote quota is implemented** — no 50/mo limit exists in code |
| Growth-only: "AI Magic Order Pad" | The AI Order Pad ships to **all** plans (portal quick-order), not gated to Growth |
| Growth-only: "reorder history" | Reorder is a **core** feature, not Growth-gated |
| (not mentioned) | **Superseded — this row predates the F1–F20 build.** The shipped, Growth-gated features are now real and testable: AI Quote Assistant (F1), Company accounts (F5), Quote analytics (F7), Accounting sync (F10), Sales-rep portal (F12), Flexible payments (F13), ERP sync (F15), Catalog sharing (F19), White-label/Agency (F20). Gates live in `app/lib/billing.ts`; the full plan/flag map is in `docs/go-live-checklist.md` and `Mannon-Reviewer-Demo-Script.md`. |

**Action:** reconcile the copy with the product before submitting — either adjust
the plan/feature split in the listing to match the shipped gates, or implement
the gates the copy promises. Shopify rejects listings whose plan descriptions
don't match app behaviour, and the copy doc's own rule is "never claim features
you haven't shipped."

### 🚩 Claims to verify
- **"on any Shopify plan / not just Plus"** and **"native net terms beyond Plus"**
  — verify current Shopify native-B2B / payment-terms availability by plan via
  the Shopify Dev MCP before publishing this claim.
- The app name/tagline here (source of truth: `Mannon-Listing-Copy.md`) differ
  from the earlier draft in `docs/listing.md` ("B2B Quotes & Reorders"). Use this
  file's copy; treat `docs/listing.md` as superseded for name/tagline.

### ℹ️ Tooling note (PART D step 12)
The Shopify CLI is **not set up in this project** (no `@shopify/cli` dependency,
no linked app). Running `shopify app` config/validate would require installing
the CLI, linking the Partner app, and authenticating — which is a manual,
interactive step, so it was not run here. Character-limit validation above was
done directly instead. Run `shopify app config link` + your validate step during
the manual submission.
