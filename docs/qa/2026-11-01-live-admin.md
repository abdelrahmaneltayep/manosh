## QA Test Report: Mannon live admin, 2026-11-01

Plan: `docs/qa/live-admin-plan.md`. Run by Claude Code on the Mac over Remote Control.

### Environment

- Branch `claude/mannon-feature-slices-w3epbf` at `57de186`. Deployed app `https://manosh.fly.dev`
  (`/healthz` → `{"status":"ok","live":true,"configOk":true,"requiredIssues":0}`).
- Dev store `mannon-9iu9ewku`, admin URL `https://admin.shopify.com/store/mannon-9iu9ewku/apps/mannon/app`.
- Browser: Playwright Chromium 149 (Chrome for Testing), headed, driven over CDP. Each demo run
  used a fresh browser context (equivalent to a private window). Claude in Chrome was enabled
  with `/chrome` but its tools never reached this session.
- Evidence: Fly logs (`fly logs -a manosh`) for every request below. Screenshots in
  `docs/qa/2026-11-01-live-admin/`.
- Demo starts spent: 3 of the 5 allowed per IP per hour.

**Admin access was blocked.** The Chromium profile is not signed in to Shopify. It stops at
accounts.shopify.com, which requires the owner's credentials, 2FA and an hCaptcha. Claude does not
enter credentials. So steps 1–11 and the final check could not be driven, and they are marked
BLOCKED, with the steps handed to the person to click (below). Steps 12–14 need no Shopify
login, and they were run.

#### TC1 — Dashboard and every left-nav page render
- **Command:** Open `…/apps/mannon/app`, then click Home, Quotes, Quote forms, Pricing & catalog, Buyers, Analytics, Settings and Pricing plans.
- **Expected:** Every page renders, with no "Something went wrong" and no blank frame.
- **Actual:** The Shopify login wall appeared (`tc01-admin-login-wall.png`). Side note: the Fly logs show the owner's own browser loading `/app`, `/app/price-rules`, `/app/analytics`, `/app/settings` and `/app/payments` as 200 between 17:49 and 17:50 UTC. That isn't evidence from this run.
- **Status:** BLOCKED (no admin sign-in)

#### TC2 — New quote priced by Shopify
- **Command:** Quotes → New quote, add two products, set quantities.
- **Expected:** Subtotal, tax and total appear, labelled as coming from Shopify.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC3 — ✦ Draft with Claude pre-fills only
- **Command:** Click "✦ Draft with Claude", then Apply.
- **Expected:** A counter is drafted on screen and nothing is sent. Apply only pre-fills the form. The upgrade note on Free or Starter is recorded.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC4 — Net 30 and Send gives a magic link
- **Command:** Choose Net 30, then Send.
- **Expected:** A confirmation with the buyer's magic link appears.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC5 — Magic link opens without login, Accept asks to confirm
- **Command:** Open the magic link in a private window and click Accept.
- **Expected:** The quote shows without login, and a confirm dialog appears before anything is written.
- **Actual:** Not run, because it depends on TC4. Related evidence from TC13 in the demo portal: clicking "Accept & create order" posted straight away, and no confirm dialog appeared first.
- **Status:** BLOCKED (depends on TC4)

#### TC6 — Accept becomes Ordered and a draft order with source Mannon
- **Command:** Confirm the accept, then check Orders → Drafts.
- **Expected:** The quote is Ordered, and a draft with source Mannon has the same totals.
- **Actual:** Not run.
- **Status:** BLOCKED (depends on TC5)

#### TC7 — AI Order Pad
- **Command:** Quote forms → AI Order Pad, then paste `20x SKU-A, 5x SKU-B` with real SKUs.
- **Expected:** Claude matches the lines, and nothing is ordered until "Confirm & build cart".
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in)

#### TC8 — Analytics ✦ Claude insights
- **Command:** Open Analytics.
- **Expected:** The insights section renders. The upgrade note on Free or Starter is recorded.
- **Actual:** Not run. The Fly log shows `GET /app/analytics` returning 200 in 272 ms from the owner's browser.
- **Status:** BLOCKED (no admin sign-in)

#### TC9 — Buyer portal reorder (magic-link session)
- **Command:** In the TC5 session, click Reorder on a "Reorder a past order" card.
- **Expected:** It becomes a draft order or a quote awaiting approval, or "no recent order" is recorded.
- **Actual:** Not run, because it depends on TC4.
- **Status:** BLOCKED (depends on TC4)

#### TC10 — Pricing plans → Choose Growth (CRITICAL, 1.2.2)
- **Command:** Pricing plans → Choose Growth, approve, then choose Starter and decline.
- **Expected:** Shopify's plan page lists Free, Starter, Growth and Scale, with no 404. After approving, the plan is Growth. After declining, the plan is unchanged.
- **Actual:** Not run. The Fly log shows the owner's browser requesting `GET /app/settings?upgrade=Growth` with 200 at 17:50:01 UTC. That doesn't show whether Shopify's plan page opened.
- **Status:** BLOCKED (no admin sign-in). **Still unproven for resubmission.**

#### TC11 — Theme app blocks render immediately (CRITICAL, 5.1.2)
- **Command:** Themes → Customize → product page → Add block "Add to Quote" → Save, then the live page and a quote submission. Repeat for "Make an Offer" and "Request a Quote".
- **Expected:** The button is visible in the editor right away with the Mannon note. On the live page it's visible with no note. The submitted quote shows under Quotes → Requests.
- **Actual:** Not run.
- **Status:** BLOCKED (no admin sign-in). **Still unproven for resubmission.**

#### TC12 — Public demo lands as Demo buyer
- **Command:** `https://manosh.fly.dev`, then Try the demo, then Open the buyer demo, in a fresh context.
- **Expected:** The buyer lands as "Demo buyer", with a Countered quote under "Your quotes" and a card under "Reorder a past order".
- **Actual:** The landing page and demo hub render (`tc12-landing.png`, `tc12-demo-hub.png`). The portal shows "Welcome, Demo buyer" and the Powderbound company, and "Your quotes" lists one New and one Countered quote (`tc12-portal.png`). **There is no "Reorder a past order" section**: the heading isn't in the page, in 2 of 2 runs. `portal._index.tsx` renders that section only when `reorderCards.length > 0`, so the demo buyer has no reorder source. The likely cause is no order on the demo store in the reorder window. The plan's wording expects a card.
- **Status:** FAIL (the Countered quote passes, the reorder card is missing)

#### TC13 — Accept the Countered quote, then Ordered and PO-DEMO-1042
- **Command:** Open the Countered quote, click "Accept & create order" and confirm.
- **Expected:** The quote shows Ordered, and Orders → Drafts has a draft with PO PO-DEMO-1042.
- **Actual:** The quote page shows three lines (The Inventory Not Tracked Snowboard 24 × 911.95, Gift Card $10 12 × 9.6, Gift Card $25 6 × 24), the PO field pre-filled with `PO-DEMO-1042`, and payment terms. It shows no subtotal, tax or total. Clicking "Accept & create order" posts with **no confirm step** (`POST /portal/quotes/:id` 200 in about 300 ms). The page then shows **"We couldn't create your order just now. Please try again."** and the quote stays Countered (`tc13-confirm-dialog.png`, `tc13-retry.png`). This reproduced in 2 of 2 fresh visitors (quotes `cmvy4jg0r000or9h4ju7dqedx` and `cmvy4llke0017r9h41mjya1nu`). Nothing is logged on Fly: the catch-all in the `portal.quotes.$id.tsx` action returns the generic message without logging the error or reporting it to Sentry, so the cause can't be seen from outside. Whether a draft was created can't be checked without admin access, but the quote never left Countered.
- **Status:** FAIL

#### TC14 — Reorder from the demo portal
- **Command:** Back in the demo portal, click Reorder on the card.
- **Expected:** A new quote marked Ordered appears, or a note that it awaits approval.
- **Actual:** There's no card to click (see TC12). The "One-tap reorder" link opens `/portal/shortcuts` (200 in 47 ms), which says "No shortcuts yet" (`tc14-shortcuts.png`). So no reorder could be attempted.
- **Status:** FAIL (blocked by the missing reorder card)

#### Final check — Mannon installed, and the customer-account "Your quotes" block renders
- **Status:** BLOCKED (no admin sign-in and no customer login)

### Summary

| Status | Count | Steps |
|---|---|---|
| PASS | 0 | — |
| FAIL | 3 | TC12, TC13, TC14 |
| BLOCKED | 12 | TC1–TC11, the final check |

**Findings to fix, not fixed during the run, as the plan requires:**

1. **The demo accept fails** (TC13). This is the core value path, and reviewers follow it. Every
   fresh demo buyer hits "We couldn't create your order just now." The order lines include two
   Gift Card variants and an untracked snowboard. Check whether `draftOrderCreate` or
   `draftOrderCalculate` rejects the gift cards, or whether the demo shop's offline session or
   scopes are the problem.
2. **The accept error is swallowed.** The generic `catch` in `app/routes/portal.quotes.$id.tsx`
   doesn't log the error or report it to Sentry, which goes against the CLAUDE.md error convention.
3. **There's no confirm step before accept** in the buyer portal. Plan step 5 expects one.
4. **The demo buyer has no reorder card** (TC12 and TC14). The demo store needs an order inside the
   reorder window, or the demo seed should create one.
5. **The buyer quote page shows no subtotal, tax or total** from Shopify. It shows only unit lines.

**The two App Store items (1.2.2 and 5.1.2) are still unproven.** TC10 and TC11 need someone
signed in to the dev store.

### Steps for the person to click (TC1–TC11 and the final check)

Follow `docs/qa/live-admin-plan.md` steps 1–11 and the final check exactly as written, signed in to
`mannon-9iu9ewku`. Do steps 10 and 11 first. Screenshot the Shopify plan page (or a 404) and, for
each of the three blocks, both the theme editor and the live product page.

### Screenshots

- `docs/qa/2026-11-01-live-admin/tc01-admin-login-wall.png`
- `docs/qa/2026-11-01-live-admin/tc12-landing.png`
- `docs/qa/2026-11-01-live-admin/tc12-demo-hub.png`
- `docs/qa/2026-11-01-live-admin/tc12-portal.png`
- `docs/qa/2026-11-01-live-admin/tc13-confirm-dialog.png`
- `docs/qa/2026-11-01-live-admin/tc13-retry.png`
- `docs/qa/2026-11-01-live-admin/tc14-shortcuts.png`

## Re-run of TC12–TC14, 18:29 UTC (release v45, `6c57c5c`)

Fixes deployed since the first run: a confirm step before accept (`613c913`); Shopify's GraphQL
errors shown to the buyer and logged in full (`849cf26`); the demo now picks a company that has a
contact (`6c57c5c`). The new logs gave the root causes in order: first
`companyContactId` was null (fixed in code), then `ACCESS_DENIED: This app is not approved to
access the CalculatedDraftOrder object` (protected customer data). The owner reported the Partner
Dashboard request as done before this re-run.

#### TC12 (re-run)
- **Actual:** Lands as "Welcome, Demo buyer" for company Snowdevil. One Countered and one New quote are listed. There's still no "Reorder a past order" section. The log says `[demo] mannon-9iu9ewku.myshopify.com has no orders in the last 60 days`, even though a test order was placed. `Order` is protected customer data too, so this probably has the same cause as TC13. (`rerun-tc12-portal.png`)
- **Status:** FAIL (no reorder card)

#### TC13 (re-run)
- **Actual:** "Accept & create order" now opens a confirm step: "Accept this quote? … Nothing is written until you confirm." It offers "Confirm & create order" and "Go back" (`rerun-tc13-confirm.png`). After confirming, the page shows "Shopify couldn't create the order: This app is not approved to access the CalculatedDraftOrder object …", and the quote stays Countered (`rerun-tc13-result.png`). The log shows `[portal.accept] … ACCESS_DENIED` for quote `cmvy5zg1p000or9h4lyspw8y1`. The PO is pre-filled as PO-DEMO-1042.
- **Status:** FAIL (protected customer data access not active for the app)

#### TC14 (re-run)
- **Actual:** There's no reorder card, so no reorder could be attempted.
- **Status:** FAIL (blocked by TC12)

**Still needed:** Shopify has to actually grant the app protected customer data access, at Level 2 with
name and email, as in `SUBMISSION-KIT.md`. After that, re-run TC12–TC14. Expect the demo to find
the new order (the card appears) and the accept to reach Ordered.

## Second re-run of TC12–TC14, 18:33 UTC (v45)

The owner reported protected customer data access as granted. The results are unchanged: TC12 has no
reorder card (`[demo] … no orders in the last 60 days`), TC13 gets `ACCESS_DENIED … CalculatedDraftOrder`
after the confirm step (quote `cmvy64ml90017r9h4tabqy5k8`, `rerun2-tc13-result.png`), and TC14 is blocked.
**Status: FAIL, FAIL, FAIL.** Per shopify.dev/docs/apps/launch/protected-customer-data, a
dev-store app can only read customer data once step 5, "Complete your Data protection details", is done,
and only after a distribution method has been chosen.

## Third re-run of TC12–TC14, 18:56 UTC (v47, `93a05fc`)

Protected customer data access is saved in the Partner Dashboard (`93a05fc`).

#### TC13 (third re-run)
- **Actual:** The confirm step appears. After confirming, `POST /portal/quotes/cmvy6yayc0005r9h45qdoe9pj` returns 204 (a redirect) in 2.1 s, with no error logged. The quote shows **Ordered** with Shopify's totals: Subtotal USD 37767.53, Tax USD 0.0, Total USD 37767.53 (`rerun3-tc13-ordered.png`). The draft order and its PO (PO-DEMO-1042) weren't checked under Orders → Drafts, because there was no admin sign-in. Minor: tax shows as `0.0`, not `0.00`.
- **Status:** PASS (admin-side draft check pending)

#### TC12 (third re-run)
- **Actual:** Lands as Demo buyer (Snowdevil) with a Countered quote. There's still no reorder card, and the log says `[demo] … no orders in the last 60 days` (`rerun3-tc12-portal.png`).
- **Status:** FAIL

#### TC14 (third re-run)
- **Status:** FAIL (no card, blocked by TC12)

**Totals for TC12–TC14:** 1 pass, 2 fail. Next: check that the store has a completed order (Orders, not Drafts) placed within the last 60 days.

## Fourth re-run of TC12–TC14, 19:17 UTC (v49, `82dab02`)

#### TC12 (fourth re-run)
- **Actual:** The log shows `[demo] … no orders the app can see in the last 60 days; seeding one (payment pending, never charged)` and then `seeded order #1001 (gid://shopify/Order/6343238811781)`. #1001 being the store's first order number suggests no completed order existed before this. The portal shows "Welcome, Demo buyer" (Snowdevil), **"Reorder a past order: #1001 · Nov 1, 2026 · USD 16980.9 · Reorder"**, and one Countered and one New quote (`rerun4-tc12-portal.png`). Minor: the card shows the total as `16980.9`, not `16,980.90`.
- **Status:** PASS

#### TC13 (fourth re-run)
- **Actual:** After the confirm step, quote `cmvy7pogk0007r9h4l84yadvh` is **Ordered** with Subtotal $37,767.53, Tax $0.00, Total $37,767.53 (`rerun4-tc13-ordered.png`). The draft and its PO weren't checked in the admin (no sign-in).
- **Status:** PASS

#### TC14 (fourth re-run)
- **Actual:** Reorder opens "Reorder #1001" with editable quantities and a PO field (`rerun4-tc14-reorder-page.png`). "Send reorder" creates quote `cmvy7pv570010r9h4kuxhxkwg`, marked **New**, with lines 12 × 949.95 and 6 × 885.95 (`rerun4-tc14-result.png`). The Minimal Snowboard was 930.25 on #1001 and is 885.95 now. With the shop's `autoApproveTolerance` at 0, `reorderNeedsApproval` holds the reorder for the merchant, so this is the "awaits approval" branch, working as designed. **But the page shows no note saying so**: the buyer only sees a "New" badge, while the plan expects "a note that it awaits the merchant's approval".
- **Status:** FAIL (behaviour correct, the buyer-facing note is missing)

**Totals for TC12–TC14:** 2 pass, 1 fail. Fix for TC14: when `createReorder` returns `needsApproval`, the quote page should say that the reorder's prices changed and the supplier will confirm.

## Fifth re-run of TC12 and TC14, v50 (`4ceb242`)

TC13 was skipped this time, because it passed on v48 and v49 and each run leaves a draft order on the store.

#### TC12 (fifth re-run)
- **Actual:** Lands as Demo buyer (Snowdevil). "Reorder a past order" shows **#1001 · Nov 1, 2026 · $16,980.90 · Reorder**: the total is now formatted as money. The Countered quote is listed (`rerun5-tc12-portal.png`).
- **Status:** PASS

#### TC14 (fifth re-run)
- **Actual:** Reorder → "Send reorder" creates quote `cmvy82h2x000mr9h5p563ddwo`, marked New, and the page says **"Waiting for your supplier. Some prices have changed since your last order, so your supplier will review this reorder before it's placed. Nothing is ordered until they do."** The note is still there after a reload (`rerun5-tc14-held-note.png`).
- **Status:** PASS

**Latest status of TC12–TC14:** TC12 PASS (v50), TC13 PASS (v48 and v49), TC14 PASS (v50). TC1–TC11 and the final check remain BLOCKED (no admin sign-in for this session).

## Re-run of TC14 with a 5% reorder tolerance, 2026-11-02 05:01 UTC (v50)

The owner set the reorder tolerance on `mannon-9iu9ewku` to 5%. Since #1001 the line prices moved by
0% (Inventory Not Tracked Snowboard, 949.95) and −4.8% (Minimal Snowboard, 930.25 → 885.95), so both
are within tolerance.

#### TC14 (tolerance 5%)
- **Command:** Fresh buyer demo, then Reorder on the #1001 card, then Send reorder.
- **Expected:** The prices are within tolerance, so the reorder converts straight to a Shopify draft order instead of waiting in the Quote Inbox.
- **Actual:** "Reorder #1001" opens (`rerun6-tc14-reorder-page.png`). Send reorder (`POST /portal/reorder/cmvy7podx0003r9h4ck6llq9d` returned 204 in 2.4 s, with no error logged) lands on quote `cmvyskv7p001fr9h5srjhnha7`, marked **Ordered**: 12 × 949.95 and 6 × 885.95, Subtotal $16,971.62, Tax $0.00, Total $16,971.62. No "Waiting for your supplier" note appears (`rerun6-tc14-auto-ordered.png`). Ordered is only set after `draftOrderCreate` succeeds, so a draft order exists. Its id wasn't checked in the admin (no sign-in).
- **Status:** PASS

**Finding (needs a look):** Shopify's subtotal is not the sum of the quote's line prices. 12 × 949.95 +
6 × 885.95 = 16,715.10, but Shopify returned 16,971.62 (+1.535%). The TC13 accept on v49 is off by the
same factor: 37,195.98 of lines against a 37,767.53 total (+1.537%). The money is Shopify's (guardrail 1),
but the buyer sees line prices that don't add up to it. Possible causes: a price adjustment on the company
location's catalog or market, or the `priceOverride` currency. Next step: open the draft order in the
admin and compare its line prices with the quote.

---

## Admin run, steps 1–11, 2026-11-02 (v50)

**Environment.** Google Chrome 156, signed in to `mannon-9iu9ewku` by the owner, driven with
Playwright `chromium.connectOverCDP("http://127.0.0.1:9222")`. Every step opened a new page in the
existing context. Buyer-side steps used a separate browser context in the same Chrome and a fresh
demo buyer. No credentials were typed. The storefront password page and the customer-account
sign-in were not entered (see TC11 and the final check). Screenshots are in
`docs/qa/2026-11-01-live-admin/admin/`.

**Where the plan and the app differ.** There is no merchant "New quote" screen: quotes come from
buyers. The merchant counters on `Quotes → <quote>`, and the app never shows the merchant a magic
link ("Counter sent to the buyer."). So TC2–TC6 ran on the real path: a fresh demo buyer's New
quote, countered in the admin, then accepted in that buyer's session. The AI Order Pad is in the
buyer portal (`/portal/quick-order`), not under Quote forms.

#### TC1 — Every left-nav page renders
- **Command:** Click each Mannon item in the admin sidebar: Home (Mannon), Quotes, Quote forms, Pricing & catalog, Buyers, Analytics, Settings, Pricing plans.
- **Expected:** Every page renders, with no "Something went wrong" and no blank frame.
- **Actual:** All 8 render in the app iframe at the right path, in 323–645 ms from click to content. Analytics shows "Quote analytics is a Growth feature … Upgrade" (see the plan mismatch in TC10). Screenshots: `admin/tc01-*.png`.
- **Status:** PASS

#### TC2 — Quote priced by Shopify
- **Command:** Open a buyer's New quote (`cmvytnate002ir9h5o5bksz5g`, 2 lines) in Quotes.
- **Expected:** Subtotal, tax and total appear, labelled as coming from Shopify.
- **Actual:** The merchant quote page shows editable quantity and unit price per line, but **no subtotal, tax or total**. The only money note is in Documents: "Taxes and the final total are calculated by Shopify at checkout." The page loaded in 4.7 s (cold). Screenshot: `admin/tc02-merchant-quote.png`.
- **Status:** FAIL (no Shopify-calculated totals on the merchant quote)

#### TC3 — ✦ Draft with Claude only pre-fills
- **Command:** Click "✦ Draft all lines with Claude", then "Use this price" on each line.
- **Expected:** A counter is drafted on screen and nothing is sent. Apply only pre-fills.
- **Actual:** Two suggestions appeared in 6.4 s, each with a margin read, a floor, a draft message and "✦ Drafted by Claude · review before sending. You send it, not the AI." The buyer's portal still showed the quote as **New**, so nothing was sent. Claude suggested the list prices ($785.95 and $24.95) because no unit cost is on file, so "Use this price" left the inputs as they were. A "Claude trial · 7 days left" badge is shown, with no upgrade block. Screenshots: `admin/tc03-claude-drafted.png`, `admin/tc03-applied.png`.
- **Status:** PASS

#### TC4 — Send the counter
- **Command:** "Send counter". (Net 30 is a buyer-side choice at accept here, so it was chosen in TC5.)
- **Expected:** A confirmation with the buyer's magic link appears.
- **Actual:** The banner says "Counter sent to the buyer." and the quote shows **Countered**, with "Internal note: a Claude draft was used". **No magic link is shown** to the merchant. Screenshot: `admin/tc04-counter-sent.png`.
- **Status:** FAIL against the plan's wording (the counter works, but there's no magic link to copy)

#### TC5 — Accept asks to confirm
- **Command:** In the buyer's session, open the Countered quote, choose Net 30, then Accept & create order.
- **Expected:** A confirm dialog appears before anything is written.
- **Actual:** "Accept this quote? … Nothing is written until you confirm." with "Confirm & create order" and "Go back". (This used the demo session, not a magic link, because of TC4.) Screenshot: `admin/tc05-confirm.png`.
- **Status:** PASS

#### TC6 — Ordered, and a draft with source Mannon
- **Command:** Confirm, then check Orders → Drafts.
- **Expected:** The quote is Ordered, and a draft with source Mannon has the same totals.
- **Actual:** With **Net 30** chosen, the accept fails: the buyer sees **"draftOrderCalculate failed: An issue date is required with net payment terms."** and the quote stays Countered (`admin/tc06-buyer-net30-error.png`). This is a real bug: `buildDraftOrderInput` sends `paymentTerms { paymentTermsTemplateId }` without the issue date that NET terms need (`paymentSchedules: [{ issuedAt }]`), and the raw Shopify error reaches the buyer. Without terms the path works: draft **#D15** has PO `PO-DEMO-1042`, is created by Mannon for Snowdevil, and comes from the TC13 accept on v49. Drafts list: `admin/tc06-admin-drafts.png`.
- **Status:** FAIL (any NET payment terms break the accept)

#### TC7 — AI Order Pad
- **Command:** Buyer portal → Open the order pad → "Paste a PO or email": `Hi, please send / 20x sku-untracked-1 / 5x sku-managed-1 / Thanks`, then "Read my order".
- **Expected:** Claude matches the lines, and nothing is ordered until the buyer confirms.
- **Actual:** In 3.0 s the order shows The Inventory Not Tracked Snowboard (`sku-untracked-1`, 20) and The Multi-managed Snowboard (`sku-managed-1`, 5). The estimated subtotal is USD 22148.75, with "Final tax & totals are calculated by the store at checkout". The buyer's quote count stayed at 2. Nothing is placed until "Request quote for these items" (that's the label, not "Confirm & build cart"). Screenshot: `admin/tc07-order-pad-matched.png`.
- **Status:** PASS

#### TC8 — Analytics ✦ Claude insights
- **Actual:** Analytics shows "Quote analytics is a Growth feature … Upgrade to Growth to unlock it." This is the upgrade note the plan allows for. The app believes the shop is on Starter (see TC10). Screenshot: `admin/tc01-analytics.png`.
- **Status:** PASS (upgrade note recorded)

#### TC9 — Reorder from the portal
- **Actual:** Covered by TC14 below, with the same fresh buyer session: the #1001 card shows, and Reorder becomes **Ordered**.
- **Status:** PASS

#### TC10 — Pricing plans → Choose Growth (CRITICAL, 1.2.2)
- **Command:** Pricing plans → Choose Growth. Then Starter → decline.
- **Expected:** Shopify's plan page lists Free, Starter, Growth and Scale, with no 404. Approve gives Growth. Decline leaves the plan unchanged.
- **Actual:**
  - **No 404**: Choose Growth goes to `admin.shopify.com/store/mannon-9iu9ewku/charges/mannon/pricing_plans`, Shopify's "Select a plan" page (`admin/tc10-shopify-plan-page.png`). **Item 1.2.2 is fixed.**
  - **The page doesn't match the app.** Shopify lists **two** plans: **Mannon Growth, $79/30 days, marked Current** (test, 13 trial days left) and **Mannon Starter, $29/30 days**. There's **no Free and no Scale**. The app's own page offers Free $0, Starter $9, Growth $29, Scale $69 (`admin/tc10-plans-before.png`).
  - **The current plan disagrees.** Shopify says Growth. The app says Starter and gates Analytics as a Growth feature. Cause: `resolveV3PlanFromName` only maps `free/starter/growth/scale`, but Shopify's plans are named "Mannon Growth" / "Mannon Starter" (handle `mannon-starter`), so they don't map.
  - **Approve** couldn't be run as written, because Growth is already current on Shopify.
  - **Decline:** Starter → "Test with this plan" opens "Approve charge … This plan is free. You will not be billed." (`admin/tc10-starter-approval.png`). There's no Decline button, so going back is the decline. The app's plan was unchanged afterwards (`admin/tc10-plans-after-decline.png`).
- **Status:** FAIL. The 404 (1.2.2) is fixed, but Shopify's plans (names, prices, Free and Scale missing) don't match the app or the listing, and the app misreads the current plan. A reviewer choosing a plan will see $79 and $29 where the app says $29 and $9.

#### TC11 — Theme app blocks (CRITICAL, 5.1.2)
- **Command:** Online Store → Themes → live theme "test-data" → Customize, product template → Product information → Add block → Apps → "Add to Quote" (Mannon) → Save. Repeat for "Make an Offer" and "Request a Quote". Then the live product page, Add to Quote, and submit with an email.
- **Expected:** Each button is visible in the editor right away, with a small Mannon note. On the live page each is visible, with no note. The submitted quote confirms in place and appears under Quotes → Requests.
- **Actual:**
  - **Editor:** all three Mannon blocks were in the picker, and each rendered **immediately** after adding, each with its note. For example: "Mannon · Add to Quote. Buyers collect products into one quote. Shown to shoppers while the widget is on in Mannon → Quote forms. Only you see this note." Each was saved (Save went disabled). Screenshots: `admin/tc11-editor-add-to-quote.png`, `…-make-an-offer.png`, `…-request-a-quote.png`. **Item 5.1.2 is fixed.**
  - **Storefront access:** the storefront is password-protected (`/password`). It was opened through the editor's own **View** link (a Shopify-issued admin preview bypass), not by entering the password.
  - **Live page:** on `/products/the-inventory-not-tracked-snowboard`, "Request a Quote", "Make an offer" and "Add to Quote" are all visible, with **no merchant note** (`admin/tc11-live-product.png`). The editor's sample product, The Minimal Snowboard, is a Draft, so an active product was used.
  - **Submit:** Add to Quote opens "Your quote" with the product, Email, Note and "Request quote" (`admin/tc11-add-to-quote-open.png`). The spam honeypot field is off-screen, `aria-hidden`, with tabindex −1. Submitting with `qa-tester@example.com` confirms in place: "Thanks — we got your quote and will reply with pricing." (`admin/tc11-quote-submitted.png`).
  - **Requests:** Mannon → Quotes → Requests lists `qa-tester@example.com · WIDGET · 1 + note · NEW`, with Convert to quote and Decline (`admin/tc11-admin-requests.png`).
- **Status:** PASS. Side effect on the store: the three Mannon blocks are now saved on the live theme's product template, and one storefront request from `qa-tester@example.com` exists.

#### TC14 — Reorder with the 5% tolerance (again, with the admin check)
- **Command:** Fresh buyer demo → Reorder on #1001 → Send reorder.
- **Expected:** It converts straight to a Shopify draft order.
- **Actual:** The quote is **Ordered** in 3.8 s: 12 × 949.95, 6 × 885.95, Subtotal $16,972.24, Tax $0.00 (`admin/tc14-reorder-result.png`). In the admin, draft **#D17** says "Mannon created this draft order", for Snowdevil (Karine Ruby) (`admin/tc14-admin-draft-D17.png`).
- **Status:** PASS

**The +1.5% price gap explained (TC13/TC14).** #D17 is in the **Canada market, currency CAD**. The
USD line prices (949.95, 885.95) became **$1,349.00 and $1,258.00 CAD**: converted, then rounded to
whole dollars by the market's price rounding. The total is $23,736.00 CAD ("approximately
$16,993.86 USD"). The app sends `priceOverride` in USD while Snowdevil's company location buys in
CAD, so Shopify converts and rounds, and the buyer's USD lines no longer add up to the total. Fix
options: send the override in the location's currency (and show it), or put the demo company's
location in the US market.

#### Final check
- **Settings → Apps and sales channels:** Mannon is listed under Installed ("Free trial") (`admin/final-apps-installed.png`). PASS.
- **Customer-account "Your quotes" block:** BLOCKED. It needs a logged-in customer account, and per the run's rule no sign-in was attempted.

### Summary of the admin run

| Status | Steps |
|---|---|
| PASS | TC1, TC3, TC5, TC7, TC8, TC9, TC11, TC14, final check (apps) |
| FAIL | TC2 (no totals on the merchant quote), TC4 (no magic link), TC6 (NET terms break the accept), TC10 (Shopify plans don't match, app misreads the plan) |
| BLOCKED | Final check (customer-account block, needs a customer sign-in) |

**The two App Store items:** 1.2.2 (plan page 404) is fixed, but the plan page now shows a pricing
mismatch a reviewer will notice. 5.1.2 (blocks render immediately) is fixed.

**Bugs to fix, in order:**
1. **NET payment terms break every accept** (TC6). `buildDraftOrderInput` needs `paymentSchedules: [{ issuedAt }]` for NET templates. Also map Shopify's raw `draftOrderCalculate failed:` text to plain language.
2. **Partner Dashboard plans vs the app** (TC10). Recreate the plans as `free/starter/growth/scale` at the app's prices, or update the app and listing to match "Mannon Growth/Starter". Also make `resolveV3PlanFromName` accept the `mannon-` prefix, so the current plan reads correctly.
3. **Currency** (TC13/TC14). Send overrides in the company location's currency, or move the demo location to the US market.
4. **Merchant quote page** (TC2). Show a Shopify-calculated subtotal, tax and total (`draftOrderCalculate`), as the buyer page does after accept.
5. **The plan doc is out of date** for TC2 (New quote), TC4 (magic link) and TC7 (Order Pad location and button label).

## Re-run of TC10 and TC6, v52 (`c9b6f12` + plans published `a3f99fc`)

Same setup: the owner's signed-in Chrome over CDP on port 9222, and a fresh demo buyer in its own context.

#### TC10 (re-run)
- **Actual:** The app's Pricing plans page shows **Growth as Current** ($29), with "Downgrade to Free", "Switch to Starter" and "Choose Scale" (`admin/rerun-tc10-app-plans.png`). "Switch to Starter" opens `…/charges/mannon/pricing_plans` with no 404. Shopify's page now lists **Free, Starter $9, Growth $29 (Current), Scale $69**, with Pay monthly and Pay yearly (`admin/rerun-tc10-shopify-plans.png`). The plans, prices and current plan now match on both sides. Nothing was approved, because Growth is already current. The decline path was checked in the earlier run.
- **Status:** PASS (1.2.2)

#### TC6 with Net 30 (re-run)
- **Actual:** Quote `cmvyxyf2l001cr9h3qxx57w1n`, Net 30, Accept, Confirm. After 2.6 s the buyer sees **"Shopify couldn't create the order: The user must have access to set payment terms. Please contact your supplier."** and the quote stays Countered (`admin/rerun-tc06-net30-scope-error.png`). The "issue date is required" error from the first run is gone, so the `paymentSchedules` fix works. Shopify now rejects the write itself: setting payment terms on a draft order needs the **`write_payment_terms`** scope (shopify.dev, `paymentTermsCreate` / DraftOrderInput), and `shopify.app.toml` requests only `read_payment_terms`. The newest draft, #D18, doesn't come from this accept: there's no PO-DEMO-1042, and the quote never left Countered.
- **Status:** FAIL. To fix: add `write_payment_terms`, with its reason in `docs/compliance.md` (guardrail 2), run `shopify app deploy`, and approve the new scope on the store. Until then, a buyer choosing any payment terms can't place the order. "Use the account default" works.

**Updated admin-run totals:** PASS: TC1, TC3, TC5, TC7, TC8, TC9, TC10, TC11, TC14, final check (apps).
FAIL: TC2, TC4, TC6. BLOCKED: final check (customer-account block).

## Second re-run of TC10 and TC6, v52 (no new commits or scopes since the first re-run)

Before the run: the branch is still at `4164687`, Fly is on v52, and `shopify.app.toml` still requests
`read_payment_terms` only. Chrome 156 is signed in on port 9222.

#### TC10 (Choose Scale)
- **Command:** Pricing plans → Choose Scale → Shopify's page → browser Back (no approval).
- **Actual:** Before: the app shows **Growth** as Current. Choose Scale opens `…/charges/mannon/pricing_plans` with no 404, listing **Free · Starter $9 · Growth $29 (Current) · Scale $69**, with Pay monthly and Pay yearly (`admin/rerun2-tc10-shopify-plans-from-scale.png`). Back returns to `…/apps/mannon/app/plans`, and the app **still shows Growth** (`admin/rerun2-tc10-app-still-growth.png`).
- **Status:** PASS

#### TC6 (Net 30 at accept)
- **Command:** Fresh demo buyer → Countered quote `cmvyy15tj001xr9h3712tytpz` → Payment terms: Net 30 → Accept & create order → Confirm → Orders → Drafts.
- **Actual:** After 2.2 s: **"Shopify couldn't create the order: The user must have access to set payment terms. Please contact your supplier."** The quote stays Countered (`admin/rerun2-tc06-net30-scope-error.png`). No draft was created: the newest in Orders → Drafts is still **#D18**, which has no PO and "Payment due later" off, not Net 30 (`admin/rerun2-tc06-admin-newest-draft-D18.png`).
- **Status:** FAIL, unchanged. The app still lacks the `write_payment_terms` scope. It isn't in `shopify.app.toml`, and Shopify's response shows it hasn't been granted for this installation either.

## Third re-run of TC6 (Net 30), after the scope update (v53, app version mannon-12)

`8b41eb0` replaced `read_payment_terms` with `write_payment_terms`. It was released with
`shopify app deploy` (mannon-11, then mannon-12) and deployed to Fly as v53. Opening Mannon then
showed Shopify's update prompt, "Mannon needs access to: … Edit other data · Payment terms"
(`admin/rerun3-scope-update-prompt.png`), and the owner clicked **Update**.

#### TC6 (Net 30 at accept)
- **Command:** Fresh demo buyer → Countered quote `cmvyyjj5b0009r9h5lepzn6hg` → Payment terms: Net 30 → Accept & create order → Confirm → Orders → Drafts.
- **Actual:** After 3.1 s the quote is **Ordered**, with Subtotal $37,757.81, Tax $0.00, Total $37,757.81 (`admin/rerun3-tc06-buyer-ordered-net30.png`). The newest draft is **#D19**: PO number **#PO-DEMO-1042**, company Snowdevil, created by Mannon, "Payment due later" on, **Payment terms: Within 30 days, Issue date November 2, 2026, "Payment due on December 2, 2026 (Net 30)."** (`admin/rerun3-tc06-admin-draft-D19-net30.png`). Like #D17, it's in the Canada market, in CAD ($52,782.00 CAD, about $37,789.43 USD). That's the currency finding from TC14, still open.
- **Status:** PASS

**Updated admin-run totals:** PASS: TC1, TC3, TC5, TC6, TC7, TC8, TC9, TC10, TC11, TC14, final check (apps).
FAIL: TC2 (no Shopify totals on the merchant quote), TC4 (no magic link shown).
BLOCKED: final check (customer-account block, needs a customer sign-in). Still open: the CAD/USD price gap.

## Currency fix verified live (v54, `09e2adb`)

**Before:** Snowdevil's location is in the Canada market, so Shopify converted the USD `priceOverride` to
CAD and rounded it to whole dollars (949.95 → $1,349.00 CAD). The app showed the `shopMoney` USD
estimate, so the buyer's lines (12 × 949.95 + 6 × 885.95 = 16,715.10) didn't add up to the
shown total ($16,971.62 to $16,993.86 across runs).

**Fix:** drafts are created with `presentmentCurrencyCode` set to the agreed (override) currency.
Totals are snapshotted from `presentmentMoney`, which Shopify calls the source of truth for the charge,
with `shopMoney` as the fallback. If a market refuses the currency, the app retries once without it, so
an order is never blocked.

#### TC14 with the fix
- **Command:** Fresh demo buyer → Reorder #1001 → Send reorder → newest draft in the admin.
- **Actual:** The buyer sees **Ordered**, 12 × 949.95, 6 × 885.95, **Subtotal $16,715.10, Total $16,715.10**: exactly the sum of the lines (`admin/currency-fix-buyer-ordered.png`). Draft **#D20**: market **Canada**, currency **US Dollar (USD $)**, line prices **$949.95** and **$885.95** at the agreed amounts, Subtotal $16,715.10, **Total $16,715.10 USD**, "Mannon created this draft order" (`admin/currency-fix-admin-draft-D20-usd.png`). No `[draft-order] … retrying` line in the Fly logs, so Shopify accepted the USD presentment currency for the Canada location.
- **Status:** PASS. The CAD/USD price gap is closed.

## TC2 fixed: Totals from Shopify on the merchant quote page (v56, `9e83b3c` + `33f3e1b`)

The merchant quote page now has a **Totals from Shopify** card. It loads after the page renders,
through the read-only GET route `/app/quote-totals/:id` (`fetcher.load`, so the page loader isn't
re-run). The amounts come from `draftOrderCalculate` for the buyer's company location; an ordered
quote shows its stored Shopify snapshot instead. "Recalculate with these prices" re-prices the counter
form's unsaved values. Nothing is created or saved, and no money is computed in the app.

#### TC2 (re-run)
- **Command:** Fresh demo buyer's New quote `cmvyzp6yu000gr9h4e2924t3j` → open in Quotes. Then change the first unit price to 700 → "Recalculate with these prices".
- **Actual:** The page renders in 2.6 s (cold, including the admin frame). The card then shows **Subtotal $8,109.00 · Tax $0.00 · Total $8,109.00 USD**, "Calculated by Shopify for this buyer's company location. Shipping isn't included." That equals 10 × 785.95 + 10 × 24.95 (`admin/tc02-fix-totals-from-shopify.png`). After Recalculate: **$7,249.50**, "Calculated by Shopify for the prices above. Not saved until you send the counter." (`admin/tc02-fix-recalculated.png`). The buyer's portal still shows the quote as New, so nothing was sent. Fly logs: one `GET /app/quote-totals/…` per load, about 760 ms on the server (mostly the Shopify call), with no duplicate request and no page reload.
- **Status:** PASS

**Updated admin-run totals:** PASS: TC1, TC2, TC3, TC5, TC6, TC7, TC8, TC9, TC10, TC11, TC14, final check (apps).
FAIL: TC4 (no magic link shown to the merchant; the plan's wording, not an app defect).
BLOCKED: final check (customer-account block, needs a customer sign-in).

## Correction: TC4 passes, and TC4–TC6 re-run through the merchant's magic link (v56)

**Correction.** The admin run recorded TC4 as FAIL ("No magic link is shown to the merchant"). That
was wrong. The tester only looked on the quote page. The app gives the merchant the link on
**Buyers → the buyer's row → Generate link**, which is what the updated plan describes. TC4 is
re-run below, and the plan now spells out the steps (`docs/qa/live-admin-plan.md` steps 2, 4, 5 and 7).

#### TC4 — Magic link for the buyer
- **Command:** Seed a fresh demo buyer (`visitor-91fdafed@demo.mannon.invalid`, with a Countered quote), then drop that session. In the admin: Buyers → that buyer's row → **Generate link**.
- **Actual:** A **"Magic link ready to send"** banner: "Copy this link and email it to the buyer. It expires automatically and can be used once.", the link `https://manosh.fly.dev/portal/auth?token=<redacted>`, and a **Copy** button. A "Magic link generated" toast appears too. The screenshot shows the buyer's row while generating, with the banner scrolled off; the token is deliberately kept out of the repo (`admin/tc04-buyers-generate-link.png`).
- **Status:** PASS

#### TC5 — The link opens the portal without a login
- **Command:** Open the link in a separate private browser context with no session.
- **Actual:** A one-click page: "Sign in to your wholesale portal · You're signing in as visitor-91fdafed@demo.mannon.invalid · **Continue**". No password, code or other credential is asked for (`admin/tc05-magic-link-continue.png`). The portal opens. On the Countered quote, Net 30 → Accept & create order shows the confirm panel "Accept this quote? … Nothing is written until you confirm." (`admin/tc05-confirm-via-link.png`).
- **Status:** PASS

#### TC6 — Ordered, with Net 30 on the draft
- **Command:** Confirm & create order, then Orders → Drafts.
- **Actual:** The quote is **Ordered**, with Subtotal **$37,195.98**, Tax $0.00, Total $37,195.98. That's exactly 24 × 911.95 + 12 × 850.51 + 6 × 850.51, which confirms the currency fix on the accept path too (`admin/tc06-ordered-via-link.png`). Draft **#D21**: PO **#PO-DEMO-1042**, Snowdevil, **$37,195.98 USD**, "Payment due on December 2, 2026 (Net 30)", created by Mannon (`admin/tc06-admin-draft-D21-net30.png`).
- **Status:** PASS

**Final admin-run totals:** PASS: TC1, TC2, TC3, TC4, TC5, TC6, TC7, TC8, TC9, TC10, TC11, TC12, TC13, TC14,
final check (apps). FAIL: none. BLOCKED: final check, customer-account "Your quotes" block (needs a
customer sign-in, which the run's rules exclude).
