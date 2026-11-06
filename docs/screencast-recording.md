# Review screencast — what to record, step by step

The screencast Shopify asks for with the submission (App Store requirement 4.5.3):
how to set up Mannon and use its core features, step by step, with the result of
each step on screen, in English or with English subtitles. It follows the reviewer
testing instructions in `SUBMISSION-KIT.md`.

**You record** 12 short clips, without sound. **I edit** them into one video: I cut
the waiting, add an English caption to every step (the subtitles), zoom in on each
result, add a title and an end card, and export a 1920×1080 MP4.

Record the clips **in order (01 → 12)**. Some depend on the one before: clip 05
uses the request from clip 04, and clips 07 and 09 use the link from clip 06.

---

## Part A — Get ready (once, about 10 minutes)

**A1. Turn off notifications**
1. Click the Control Centre icon (top-right of the menu bar).
2. Click **Focus** → **Do Not Disturb**.

**A2. Prepare Chrome**
1. Open the Chrome you use for Mannon (the `~/mannon-chrome` profile) and close every tab except one.
2. Press **⌘⇧B** to hide the bookmarks bar.
3. Press **⌘0** to set the zoom to 100%.
4. Make the window large: double-click its title bar, or drag it to roughly 1920×1080.

**A3. Open the storefront once (so the password is never typed on camera)**
1. In that Chrome, go to `https://mannon-9iu9ewku.myshopify.com`.
2. Type the storefront password and press Enter.
3. Open a private window (**⌘⇧N**), go to the same address, enter the password there too, then close the private window.

**A4. Check the store is ready (look only, change nothing)**
1. Shopify Admin → **Customers → Companies → Snowdevil**: there is a location, and the
   contact `karine.ruby@example.com` is assigned to it.
2. Shopify Admin → **Products**: **Harbor Blend Espresso, 1 kg** is there and Active.

**A5. Set up the screen recorder**
1. Press **⌘⇧5**. A toolbar appears at the bottom of the screen.
2. Click **Record Selected Portion** (the dotted rectangle with a circle).
3. Drag the frame so it covers the Chrome window exactly.
4. Click **Options** and set: **Save to → Desktop**, **Microphone → None**, tick **Show Mouse Clicks**.
5. Press **Esc** to close the toolbar for now. macOS remembers the frame and options.

**A6. Keep this text ready to paste** (in Notes or TextEdit, outside the recording frame)
```
karine.ruby@example.com
Snowdevil
Hi team, please send for next week:
24x HB-ESP-1KG
6x sku-managed-1
2x sku-hosted-1
Thanks!
```

### How every clip works
- **To start:** set up the starting screen described in the clip, press **⌘⇧5**, then click **Record**.
- **During the clip:** move the mouse slowly. Wherever you see **⏸ Hold 2 s**, stop moving for two seconds so the viewer can read the result.
- **To stop:** click the **⏹ stop button** in the menu bar, or press **⌘⌃Esc**.
- **Afterwards:** a file called "Screen Recording … .mov" appears on the Desktop. Rename it to the clip's name, e.g. `clip-01.mov`.
- **If something goes wrong:** stop, delete that file, and record the clip again. Only that clip.

---

## Part B — The clips

### Clip 01 — Open Mannon in Shopify Admin (about 30 s)
**Starting screen:** Shopify Admin home (`admin.shopify.com/store/mannon-9iu9ewku`).

1. Start recording.
2. In the left sidebar, click **Apps**, then **Mannon**. Wait until the Mannon Home page loads. ⏸ Hold 2 s.
3. In Mannon's navigation, click each of these in turn, waiting for each page to load: **Quotes** → **Quote forms** → **Pricing & catalog** → **Buyers** → **Analytics** → **Settings** → **Pricing plans**.
4. Click **Home** to come back. ⏸ Hold 2 s.
5. Stop recording. Rename to `clip-01.mov`.

### Clip 02 — The B2B company comes from Shopify (about 20 s)
**Starting screen:** Shopify Admin.

1. Start recording.
2. In the left sidebar, click **Customers**, then **Companies**.
3. Click **Snowdevil**.
4. Scroll so the location and the contact `karine.ruby@example.com` are both visible. ⏸ Hold 2 s.
5. Stop recording. Rename to `clip-02.mov`.

### Clip 03 — Add the storefront button to the theme (about 30 s)
**Starting screen:** Mannon open in Shopify Admin.

1. Start recording.
2. Click **Quotes**, then the **Requests** tab at the top.
3. Scroll down to the card **Add quote requests to your storefront**. ⏸ Hold 2 s on the three steps.
4. Click **Add to theme** next to **Request a Quote**. A new tab opens with the theme editor, and the block is already placed on the product page. ⏸ Hold 2 s.
5. **Do not click Save** (your theme already has this block; saving would add a second one).
6. Close that tab (**⌘W**). If Chrome asks "Leave site?", click **Leave**.
7. Stop recording. Rename to `clip-03.mov`.

### Clip 04 — A buyer asks for a quote on the storefront (about 40 s)
**Starting screen:** a new tab with `https://mannon-9iu9ewku.myshopify.com/products/harbor-blend-espresso-1-kg`, scrolled to the top.

1. Start recording.
2. Move the mouse slowly over the buttons **Request a Quote**, **Make an offer** and **Add to Quote**. ⏸ Hold 2 s. (The price is hidden because the store hides prices from logged-out visitors; that's a Mannon feature.)
3. Click **Request a Quote**. A form opens.
4. Fill it in:
   - **Email:** paste `karine.ruby@example.com`
   - **Company:** paste `Snowdevil`
   - **Quantity:** `24`
5. Click **Send request**.
6. ⏸ Hold 2 s on "Thanks — we got your request and will reply with pricing."
7. Stop recording. Rename to `clip-04.mov`.

### Clip 05 — Turn the request into a quote, price it, counter it (about 70 s)
**Starting screen:** Mannon → **Quotes → Requests**.

1. Start recording.
2. Find the newest row with `karine.ruby@example.com` (the one you just sent) and click **Convert to quote**. The quote page opens.
3. Point at the card **Totals from Shopify** (subtotal, tax, total). ⏸ Hold 2 s.
4. Click the **Unit price** box, change it (e.g. from `21.50` to `20.00`), then click **Recalculate with these prices**.
5. ⏸ Hold 2 s on the new totals and the note "Not saved until you send the counter".
6. Click **✦ Draft all lines with Claude**. Wait for the suggestion (a few seconds). ⏸ Hold 2 s.
7. Click **Use this price**.
8. Click **Send counter**.
9. ⏸ Hold 2 s on "Counter sent to the buyer".
10. Stop recording. Rename to `clip-05.mov`.

### Clip 06 — Send the buyer their sign-in link (about 15 s)
**Starting screen:** Mannon open in Shopify Admin.

1. Start recording.
2. Click **Buyers**.
3. In the row with `karine.ruby@example.com`, click **Generate link**.
4. ⏸ Hold 2 s on **Magic link ready to send**.
5. Click the link text to select it and copy it (**⌘C**).
6. Stop recording. Rename to `clip-06.mov`.

### Clip 07 — The buyer accepts the quote on Net 30 (about 50 s)
**Starting screen:** a new private window (**⌘⇧N**) with an empty tab.

1. Start recording.
2. Paste the link into the address bar (**⌘V**) and press Enter.
3. ⏸ Hold 2 s on "You're signing in as karine.ruby@example.com" (no password), then click **Continue**.
4. On the portal home, under **Your quotes**, click the newest quote marked **Countered**.
5. Under **Payment terms**, choose **Net 30**.
6. Click **Accept & create order**. ⏸ Hold 2 s on the confirm panel ("Nothing is written until you confirm").
7. Click **Confirm & create order**.
8. ⏸ Hold 2 s on the status **Ordered** with the subtotal, tax and total.
9. Stop recording. Rename to `clip-07.mov`. **Keep this private window open** for clip 09.

### Clip 08 — The order is a real Shopify draft order (about 20 s)
**Starting screen:** Shopify Admin (the normal window).

1. Start recording.
2. In the left sidebar, click **Orders**, then **Drafts**.
3. Click the newest draft (top of the list).
4. Scroll slowly to show: the company **Snowdevil**, the line with your agreed price, the **Net 30** payment terms, and the tax and total. ⏸ Hold 2 s.
5. Stop recording. Rename to `clip-08.mov`.

### Clip 09 — Paste a purchase order; Claude reads it (about 40 s)
**Starting screen:** the private window from clip 07, on the portal home (click the **Mannon** logo at the top to get there).

1. Start recording.
2. Click **Open the order pad**.
3. Scroll to **Paste a PO or email** and click in the box.
4. Paste the PO from A6 (the five lines starting "Hi team, please send…").
5. Click **Read my order**. Wait a few seconds.
6. Scroll down to **Your order**. ⏸ Hold 2 s on the matched lines.
7. Move the mouse to **Request quote for these items**, but **do not click it**. ⏸ Hold 2 s.
8. Stop recording. Rename to `clip-09.mov`. You can close the private window now.

### Clip 10 — One-tap reorder, on the public demo (about 35 s)
**Starting screen:** a new private window (**⌘⇧N**) with an empty tab.

1. Start recording.
2. Go to `https://manosh.fly.dev/demo` and press Enter.
3. Click **Open the buyer demo**. The demo buyer's portal opens.
4. Under **Reorder a past order**, click **Reorder**.
5. ⏸ Hold 2 s on the order lines, then click **Send reorder**.
6. ⏸ Hold 2 s on the result (**Ordered**, or a note that it waits for the supplier).
7. Stop recording. Rename to `clip-10.mov`. Close the private window.

### Clip 11 — Make an Offer and price rules (about 40 s, optional)
**Starting screen:** the espresso product page from clip 04.

1. Start recording.
2. Click **Make an offer**. Fill in:
   - **Email:** paste `karine.ruby@example.com`
   - **Quantity:** `24`
   - **Your offer (per unit):** `18`
3. Click **Send offer**. ⏸ Hold 2 s on the message (your offer rules may answer it straight away; any answer is fine).
4. Switch to the Shopify Admin tab: Mannon → **Pricing & catalog** → **Offers** tab. ⏸ Hold 2 s on the new offer in the list.
5. Click the **Price rules** tab. ⏸ Hold 2 s on the rule **Logged-out visitors · hide price**.
6. Stop recording. Rename to `clip-11.mov`.

### Clip 12 — Plans are billed by Shopify (about 25 s)
**Starting screen:** Mannon open in Shopify Admin.

1. Start recording.
2. Click **Pricing plans**. ⏸ Hold 2 s on the four plans (Growth is marked as your current plan).
3. Click **Choose Scale** (your store is on Growth, so that is the button you will see).
4. Shopify's own plan page opens. ⏸ Hold 2 s.
5. Go back without approving (browser **Back**, or **⌘[**).
6. Stop recording. Rename to `clip-12.mov`.

---

## Part C — Send me the clips

1. On the Desktop you now have `clip-01.mov` … `clip-12.mov` (clip 11 is optional).
2. Open Google Drive, create a folder **Mannon screencast**, and drag the clips into it.
3. Right-click the folder → **Share** → **General access: Anyone with the link** (Viewer) → **Copy link**.
4. Send me the link.

I'll fetch the clips through the Drive connector, edit them here, and send back:
- `mannon-review-screencast.mp4` (1920×1080, about 5–6 minutes, English captions burned in) and `mannon-review-screencast.srt` (the same captions as a subtitle file), for the submission.
- If you want, a promotional 2–3 minute cut for the listing (Shopify asks that screen recording be no more than a quarter of that one).

## Afterwards

The clips create real test data on the dev store: one quote request and quote, one
draft order (payment pending, Net 30), one demo reorder and, with clip 11, one offer.
They're harmless, and you can delete the draft order under **Orders → Drafts** whenever you like.
