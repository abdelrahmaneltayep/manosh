# Live admin QA plan (for a Claude Code session running on the Mac with a browser)

Run these 14 reviewer steps in a browser signed in to the dev store and report PASS/FAIL per
step with a screenshot for each. Follow the qa-tester protocol: capture evidence before
asserting, one verdict per case, clean up.

**Context.** Branch `claude/mannon-feature-slices-w3epbf`. Fly has the same code deployed; the
Shopify app version mannon-10 carries the theme app extension. The App Store reviewer suspended
the app for two items, both fixed in this code: **1.2.2** (Choose plan opened Shopify's "There's
no page at this address"; the pricing URL now reads the app handle from the Admin API) and
**5.1.2** (theme app blocks rendered nothing until a config call; they now render as soon as they
are added). Steps 10 and 11 are the proof for those two: do them first if budget is short.

**Store.** Dev store `mannon-9iu9ewku`. App inside the admin:
`https://admin.shopify.com/store/mannon-9iu9ewku/apps/mannon/app`. Public app:
`https://manosh.fly.dev`. Nothing here charges money: the dev store uses Shopify's test mode for
plans, and accepted quotes become draft orders only.

**Rules.** Do not change store settings beyond what a step needs, do not uninstall the app, do
not touch other apps or themes, do not fix code during the run. Record what you actually see; if
a step is blocked, say why and move on.

## Steps and expected results

1. Open the app from Apps. The dashboard loads inside the admin. Click each left-nav item (Home,
   Quotes, Quote forms, Pricing & catalog, Buyers, Analytics, Settings, Pricing plans). Every page
   renders: no "Something went wrong", no blank frame.
2. Quotes → New quote: add two products, set quantities. Subtotal, tax and total appear, labelled
   as coming from Shopify.
3. Click "✦ Draft with Claude". A counter is drafted on screen, nothing is sent. Click Apply: it
   only pre-fills the form. On Free or Starter the control may show an upgrade note; record that.
4. Choose Net 30 and Send. A confirmation with the buyer's magic link appears. Copy the link.
5. Open the magic link in a private window. The quote shows without any login. Click Accept: a
   confirm dialog appears before anything is written.
6. Confirm. The quote flips to Ordered. In the admin, Orders → Drafts has a new draft with source
   Mannon and the same totals.
7. Quote forms → AI Order Pad: paste two lines like `20x SKU-A, 5x SKU-B` using real SKUs from the
   store. Claude matches the lines; nothing is ordered until "Confirm & build cart".
8. Analytics: the ✦ Claude insights section renders. On Free or Starter it may show an upgrade
   note; record it.
9. Buyer portal (same magic-link session): "Reorder a past order" lists a card if the store has an
   order in the last 60 days. Click Reorder and record whether it became a draft order or a quote
   awaiting approval. No card: record "no recent order" and move on.
10. **Pricing plans → Choose Growth. CRITICAL (1.2.2).** Shopify's plan page must open and list
    Free, Starter, Growth and Scale. Approve (test mode): you return to the app and the plan shows
    Growth. Open Pricing plans again, choose Starter, and decline on Shopify's page: you return with
    the plan unchanged. Screenshot the plan page with the four plans, or the 404 if it appears.
11. **Online Store → Themes → Customize → a product page → Add block → "Add to Quote" → Save.
    CRITICAL (5.1.2).** The button is visible in the editor right away with a small Mannon note
    under it. Open the live product page: the button is visible, no note. Click it, add the
    product, submit a quote with an email: it confirms in place and appears under Mannon →
    Quotes → Requests. Repeat the add-block part for "Make an Offer" and "Request a Quote".
    Screenshot the editor and the live page for each.
12. `https://manosh.fly.dev` → Try the demo → Open the buyer demo, in a fresh private window. You
    land as "Demo buyer" with a quote marked Countered under "Your quotes" and a card under
    "Reorder a past order".
13. Open the Countered quote, click "Accept & create order", then "Confirm & create order" in the panel that appears (nothing is written before that). It shows Ordered. On the dev
    store, Orders → Drafts has a draft with PO PO-DEMO-1042.
14. Back in the demo portal, click Reorder on the card. Either a new quote marked Ordered appears
    or a note that it awaits the merchant's approval.

Finally: Settings → Apps and sales channels shows Mannon installed, and the customer-account
"Your quotes" block still renders on the new customer account for a logged-in customer.

## Report

Write `docs/qa/2026-11-01-live-admin.md`: "## QA Test Report: Mannon live admin, 2026-11-01",
Environment, one `#### TCn` block per step (Command / Expected / Actual / Status), a Summary with
totals, and the screenshot paths. Commit on the current branch as
`docs(qa): live admin click-through 2026-11-01` and push to
`origin claude/mannon-feature-slices-w3epbf`.

If you cannot drive a browser, say so and hand the numbered steps to the person to click.
