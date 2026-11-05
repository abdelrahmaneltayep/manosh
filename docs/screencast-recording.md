# Review screencast — what to record

The screencast Shopify asks for with the submission (App Store requirement
4.5.3): how to set up Mannon and use its core features, step by step, with the
result of each step on screen, in English or with English subtitles. It follows
the reviewer testing instructions in `SUBMISSION-KIT.md` step for step, so the
reviewer can watch what they are about to do.

**Your part:** record the 12 clips below as separate files, without narration.
**My part:** trim the waits, add an English caption for every step (these are
the subtitles), zoom in on each result, add a title and an end card, and export
one 1920×1080 MP4 of about 5–6 minutes.

---

## Before you record (once)

1. **Notifications off:** macOS Focus → Do Not Disturb. Slack, Chrome and calendar
   pop-ups must not appear in the video.
2. **A clean Chrome window:** use the `~/mannon-chrome` profile, with only the tabs
   you need. Hide the bookmarks bar (⌘⇧B), set zoom to 100% and make the window
   about 1920×1080.
3. **macOS screen recording:** press ⌘⇧5, choose **Record Selected Portion**, and draw
   the area around the Chrome window. Under **Options**, turn on **Show Mouse Clicks**
   and set the microphone to **None**.
4. **Store setup** (already true on `mannon-9iu9ewku`):
   - The storefront password is already entered in the Chrome you record with
     (open the store once before recording), so it never appears on screen.
   - **Customers → Companies:** Snowdevil has a location, and the contact
     `karine.ruby@example.com` is assigned to it.
   - The product **Harbor Blend Espresso, 1 kg** exists.
   - The guest price-gating rule is on. That's fine: it shows the price gate.
5. **Have these ready to paste:**
   - Email: `karine.ruby@example.com`
   - Company: `Snowdevil`
   - The PO for clip 9:
     ```
     Hi team, please send for next week:
     24x HB-ESP-1KG
     6x sku-managed-1
     2x sku-hosted-1
     Thanks!
     ```

**While recording:** move the mouse slowly, and after every click that shows a
result (a confirmation, a total, a status), **hold still for 2 seconds**. Don't
worry about pauses or mistakes; stop the clip and redo it, and I cut the rest.
Never type a password on camera.

---

## The clips

Save them as `clip-01.mov`, `clip-02.mov`, and so on. Times are rough; take as long as you need.

### Clip 01 — Open Mannon in Shopify Admin (~30 s)
1. Shopify Admin → **Apps → Mannon**. The Home dashboard opens.
2. Click slowly through the left navigation: **Quotes, Quote forms, Pricing &
   catalog, Buyers, Analytics, Settings, Pricing plans**. Let each page load.

On screen: every page loads inside Shopify Admin.

### Clip 02 — The B2B company comes from Shopify (~20 s)
1. **Customers → Companies → Snowdevil.**
2. Show the location and the contact `karine.ruby@example.com` assigned to it.

On screen: Mannon uses Shopify's own companies, locations and contacts.

### Clip 03 — Add the storefront block (~30 s)
1. **Mannon → Quotes → Requests.** Scroll to **Add quote requests to your storefront**.
2. Click **Add to theme** next to **Request a Quote**. The theme editor opens in a
   new tab with the block placed on the product page. Hold 2 s.
3. **Don't click Save:** your theme already has the block, and saving would add it
   twice. Close the tab (choose **Leave** if asked).

On screen: one click places the block; nothing changes until the merchant saves.

### Clip 04 — A buyer asks for a quote on the storefront (~40 s)
1. Open `https://mannon-9iu9ewku.myshopify.com/products/harbor-blend-espresso-1-kg`.
2. Show the buttons **Request a Quote, Make an offer, Add to Quote**, and that the
   price is hidden for logged-out visitors.
3. Click **Request a Quote**. Fill in the email `karine.ruby@example.com`, the company
   `Snowdevil` and quantity `24`. Click **Send request**.

On screen: "Thanks — we got your request and will reply with pricing."

### Clip 05 — Convert, recalculate, draft with Claude, send the counter (~70 s)
1. **Mannon → Quotes → Requests.** In the row with `karine.ruby@example.com`, click
   **Convert to quote**.
2. On the quote, point at **Totals from Shopify** (subtotal, tax, total). Hold 2 s.
3. Change the **Unit price** (for example 21.50 → 20.00), then click **Recalculate with
   these prices**. Hold on the new totals and "Not saved until you send the counter".
4. Click **✦ Draft all lines with Claude**. Wait for the suggestion, hold 2 s, then
   click **Use this price**.
5. Click **Send counter**.

On screen: "Counter sent to the buyer"; status **Countered**.

### Clip 06 — Send the buyer their sign-in link (~15 s)
1. **Mannon → Buyers.** In the row with `karine.ruby@example.com`, click **Generate link**.
2. Hold on **Magic link ready to send**, then copy the link.

### Clip 07 — The buyer accepts on Net 30 (~50 s)
1. Open a **private window** (⌘⇧N) and paste the link. Click **Continue** (no password).
2. On the portal home, open the **Countered** quote.
3. Choose **Payment terms → Net 30** and click **Accept & create order**. Hold on the
   confirm panel ("Nothing is written until you confirm").
4. Click **Confirm & create order**.

On screen: status **Ordered**, with subtotal, tax and total from Shopify.

### Clip 08 — The draft order in Shopify (~20 s)
1. Back in Shopify Admin: **Orders → Drafts**. Open the newest draft.
2. Show the company **Snowdevil**, payment terms **Net 30**, the agreed prices, and
   Shopify's tax and total.

### Clip 09 — Order pad: paste a PO, Claude reads it (~40 s)
1. In the buyer's private window: portal home → **Open the order pad**.
2. Paste the PO from step 5 of the setup into **Paste a PO or email**. Click **Read my order**.
3. Hold on the matched lines under **Your order**. Point at **Request quote for these
   items** but **don't click it**.

On screen: Claude's matches; nothing is ordered until the buyer confirms.

### Clip 10 — One-tap reorder, from the public demo (~35 s)
1. New private window: `https://manosh.fly.dev/demo` → **Open the buyer demo**.
2. On **Reorder a past order**, click **Reorder**, then **Send reorder**.

On screen: the new quote shows **Ordered**, or "waiting for your supplier" when it's
over the auto-approve tolerance.

### Clip 11 — Make an Offer and price rules (~40 s, optional)
1. On the espresso product page, click **Make an offer**, enter a price below list
   and send it.
2. **Mannon → Pricing & catalog → Offers:** open the offer and show **Send counter**
   (sending it is optional).
3. **Price rules:** show the **Logged-out visitors · hide price** rule.

### Clip 12 — Plans are billed by Shopify (~25 s)
1. **Mannon → Pricing plans.** Click any **Choose …** or **Switch to …** button. Your
   store is on Growth, so it shows **Choose Scale**.
2. Shopify's own plan page opens and lists the plans. Hold 2 s, then go back without
   approving, or approve: the dev store uses test charges.

---

## Sending me the clips

The clips are too large for chat, so put them in **one Google Drive folder** and share
it with "anyone with the link can view". Send me the link: I'll fetch them through the
Drive connector, edit them here with ffmpeg, and send back:

- `mannon-review-screencast.mp4` (1920×1080, about 5–6 min, English captions burned
  in, plus a separate `.srt` subtitle file), for the submission.
- If you want, a promotional 2–3 minute cut for the listing (Shopify asks that
  screen recording be no more than a quarter of that one).

If a clip goes wrong, just re-record that clip; the others stay as they are.
