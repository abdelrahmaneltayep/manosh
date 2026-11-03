# Mannon — 4:00 walkthrough, narrated in Menna's voice

Full-app screencast for the App Store listing and the landing page, written to the Menna
voice guide (`MENNA_VOICE_AND_TONE.md`, kit of 2026-11-03) and cut to the walkthrough
template in `docs/brand.md` §9. Scenes, slots and captions are the source of truth; the
narration is paced to fit them at Menna's measured 150 words a minute.

**Two deliberate exceptions to `docs/brand.md` §9, because the narrator is Menna:**

- Voice is Menna (female, warm, "older sister"), not the male narrator the brand guide
  names. Keep her as the single voice across every Mannon video from now on, or revert the
  guide; do not mix narrators in one series.
- No music bed. Menna's guide is explicit: her voice is the only sound. Keep the click
  ripple silent as before.

**Consent, before any audio exists:** cloning Menna's voice needs her explicit permission,
in writing, before the reference sample is uploaded to ElevenLabs. Best option: she records
this script herself and the take is cleaned with Voice Isolator. If the voice in the
published video is synthetic, say so in the YouTube description.

What never changes: every price on screen comes from Shopify; Claude drafts and a person
confirms; no prices, plan names or statistics are spoken; the one recurring line is
**Built on Shopify's native B2B — every price comes from Shopify.**

---

## Timing table (240 s, 16 scenes — fitted to the warm takes of 2026-11-03)

| # | Slot | Scene | On-screen source | Words |
|---|---|---|---|---|
| 1 | 0:00–0:16 | Cold open, landing page | `https://manosh.fly.dev` | 31 |
| 2 | 0:16–0:29 | Embedded in the Shopify admin | `admin.shopify.com/store/mannon-9iu9ewku/apps/mannon` | 29 |
| 3 | 0:29–0:38 | Home dashboard | Mannon → Home | 20 |
| 4 | 0:38–0:49 | Quote inbox | Mannon → Quotes | 22 |
| 5 | 0:49–1:05 | A quote priced by Shopify | Quotes → the demo buyer's New quote | 29 |
| 6 | 1:05–1:23 | ✦ Draft all lines with Claude | same page | 41 |
| 7 | 1:23–1:33 | Send counter | same page | 23 |
| 8 | 1:33–1:45 | Buyer's magic link | Mannon → Buyers → Generate link | 30 |
| 9 | 1:45–2:06 | Buyer portal, Net 30, accept, confirm | the magic link, private window | 48 |
| 10 | 2:06–2:19 | The real draft order | Shopify admin → Orders → Drafts | 30 |
| 11 | 2:19–2:36 | One-tap reorder | portal home → Reorder a past order | 37 |
| 12 | 2:36–2:51 | AI Order Pad | portal → Open the order pad | 35 |
| 13 | 2:51–3:05 | Quote analytics + ✦ Claude insights | Mannon → Analytics | 28 |
| 14 | 3:05–3:23 | Beyond the core loop (montage) | storefront block · Make an Offer · Pricing plans | 38 |
| 15 | 3:23–3:46 | Try the demo | `/demo` → Open the buyer demo → draft order | 65 |
| 16 | 3:46–4:00 | Close, logo card | logo card | 26 |

Total ≈ 532 spoken words. At 150 wpm that is 3:33 of speech inside 4:00, which leaves the
0.5 s beat after every phrase and the 1 s beat before each new scene. Every scene's VO ends
at least 0.6 s before its slot does.

---

## Scenes

Format per scene: **On screen** (what is recorded, with exact UI text) · **VO** (Menna's
lines, one phrase per line, `...` = 0.5 s beat, blank line = 1 s beat) · **Captions** (lower
third, one at a time, B swaps in at 52 % of the slot) · **Emphasis** (the words to lift,
and the gold subtitle words).

### 1 · Cold open · 0:00–0:16

**On screen:** Landing page at `manosh.fly.dev`, hero "Wholesale quoting, *without the email
grind*". Slow 2 % zoom. Cursor rests, no click.

**VO**
```
Wholesale quoting...
without the email grind.

This is Mannon,
a B2B quoting app for Shopify.

It runs on Shopify's own B2B,
companies, catalogs, payment terms,
and every price comes from Shopify.
```
**Captions:** A "Wholesale quoting, without the email grind." · B "Built on Shopify's native B2B — every price comes from Shopify."
**Emphasis:** *email grind*, *Shopify*.

### 2 · Embedded in the admin · 0:16–0:29

**On screen:** The app opening inside the Shopify admin: loading skeleton, then Home with
the left nav Home · Quotes · Quote forms · Pricing & catalog · Buyers · Analytics · Settings
· Pricing plans. Cursor eases down the nav.

**VO**
```
Mannon lives inside your Shopify admin.

Everything is in one place...
quotes, buyers, analytics, settings.

So let me show you the whole flow,
from a quote to a reorder.
```
**Captions:** A "Embedded in your Shopify admin." · B "Quotes, buyers, analytics and settings, in one place."
**Emphasis:** *inside*, *whole flow*.

### 3 · Home · 0:29–0:38

**On screen:** Home dashboard: the quote funnel cards and the open-quotes list. Cursor on
the first card.

**VO**
```
Home is your morning view.

How many quotes came in,
how many were accepted,
and what still needs you today.
```
**Captions:** A "What came in, what was accepted, what needs you." · B "Always up to date."
**Emphasis:** *today*.

### 4 · Quote inbox · 0:38–0:49

**On screen:** Quotes list: status badges New · Countered · Ordered, buyer and company per
row. Cursor on the demo buyer's New quote.

**VO**
```
This is the quote inbox.

Every request from a buyer lands here,
with its status...
New, Countered, Ordered.

So let's open one.
```
**Captions:** A "Every buyer request lands in one inbox." · B "New · Countered · Ordered."
**Emphasis:** *inbox*, *email threads*.

### 5 · Priced by Shopify · 0:49–1:05

**On screen:** The quote page: lines with quantity and unit price, then the "Totals from
Shopify" card filling in Subtotal, Tax and Total, "Calculated by Shopify for this buyer's
company location". Reveal on the card as the VO names it.

**VO**
```
Here's the quote.

And look at this card...
Totals from Shopify.

Subtotal, tax, total.
Mannon never calculates money itself.

It asks Shopify,
and Shopify answers for this buyer's company.
```
**Captions:** A "Totals from Shopify, for this buyer's company." · B "Mannon never calculates money itself."
**Emphasis:** *Totals from Shopify*, *never*.

### 6 · ✦ Draft with Claude · 1:05–1:23

**On screen:** Click "✦ Draft all lines with Claude". The drafted counter prices appear per
line with "Use this price" buttons. One click on "Use this price" pre-fills that line.
Nothing is sent.

**VO**
```
Now the fun part.

Click... Draft all lines with Claude.

Claude drafts a counter price for each line.

But here's the rule.
Claude only drafts.
You pick "Use this price", line by line,
and nothing is sent until you say so.
```
**Captions:** A "✦ Claude drafts a counter for every line." · B "Claude drafts. You review and send. It never acts on its own."
**Emphasis:** *drafts*, *Use this price*, *control*.

### 7 · Send counter · 1:23–1:33

**On screen:** Click "Send counter". Banner "Counter sent to the buyer." and the status
flips to Countered.

**VO**
```
Happy with it?
Click Send counter.

The status flips to Countered,
and the buyer gets the news.

That's it. No email to write.
```
**Captions:** A "Send counter." · B "Counter sent to the buyer."
**Emphasis:** *Send counter*.

### 8 · The magic link · 1:33–1:45

**On screen:** Buyers page, the demo buyer's row, click "Generate link". The "Magic link
ready to send" card with the Copy link button. **The link itself is blurred in the edit;
never show the token.** Toast "Magic link generated".

**VO**
```
How does the buyer get in?
No password. A magic link.

Go to Buyers,
click Generate link,
and copy it.

One link, one buyer,
and it expires on its own.
```
**Captions:** A "Buyers → Generate link." · B "No passwords. One link per buyer, and it expires."
**Emphasis:** *magic link*, *expires*.

### 9 · Buyer portal, Net 30, accept · 1:45–2:06

**On screen:** Private window with the "Incognito" tag. The link opens "Sign in to your
wholesale portal … Continue", then the portal. Open the Countered quote. Payment terms
select → Net 30. Click "Accept & create order". The confirm panel: "Accept this quote? …
Nothing is written until you confirm." Click "Confirm & create order". Status flips to
Ordered with Shopify's Subtotal, Tax and Total.

**VO**
```
This is what the buyer sees.
No login screen.

They open the countered quote,
pick their payment terms...
Net thirty.

Then Accept and create order.

And then, a confirm panel.
Nothing is written until they confirm.

They confirm...
and the quote is Ordered,
with Shopify's tax and total.
```
**Captions:** A "Net thirty, straight from Shopify's payment terms." · B "Nothing is written until the buyer confirms."
**Emphasis:** *no login*, *Net thirty*, *confirm*, *Ordered*.

### 10 · The real draft order · 2:06–2:19

**On screen:** Shopify admin, Orders → Drafts. The new draft: "Mannon created this draft
order", PO number, company Snowdevil, "Payment due on … (Net 30)". Cursor on the terms.

**VO**
```
So where did the order go?
Straight into Shopify.

Orders, Drafts, and there it is.
A real Shopify draft order,
with the PO number,
the company, and the net terms.
```
**Captions:** A "A real Shopify draft order, with the PO and net terms." · B "Nothing to copy over."
**Emphasis:** *real*, *Ever*.

### 11 · One-tap reorder · 2:19–2:36

**On screen:** Portal home, "Reorder a past order" card: order number · date · total.
Click Reorder, then "Send reorder". It becomes a draft order (or shows "Waiting for your
supplier" when prices moved past the merchant's tolerance).

**VO**
```
Weeks later,
the buyer wants the same thing again.

So, on their portal,
Reorder a past order.
One tap.

Shopify re-prices it today.
Within your tolerance, it's a draft order.
Otherwise, it waits for you to review.
```
**Captions:** A "Reorder a past order, one tap." · B "Re-priced by Shopify. Outside your tolerance, you review it first."
**Emphasis:** *one tap*, *re-prices*, *tolerance*.

### 12 · AI Order Pad · 2:36–2:51

**On screen:** Portal → the order pad. Paste "20x <sku>, 5x <sku>" into "Paste a PO or
email", click "Read my order". Claude's matched lines appear with the real products. Click
"Request quote for these items".

**VO**
```
Buyers can paste a whole PO,
and click Read my order.

Claude matches every line
to a real product in your catalog.

Every id is checked against Shopify.
The buyer confirms,
then a quote exists.
```
**Captions:** A "Paste a PO or an email. Claude reads the lines." · B "Every product id is checked against Shopify. The buyer confirms."
**Emphasis:** *paste*, *real product*, *confirms*.

### 13 · Analytics + Claude insights · 2:51–3:05

**On screen:** Analytics: "Quote analytics" with the funnel and the "✦ Claude insights"
section (win-rate, credit-risk, buyer summary). Cursor on the insights.

**VO**
```
Analytics shows your quote funnel.

And Claude insights reads it with you...
win rate, credit risk, a buyer summary.

Advisory only, on screen only.
It never changes anything.
```
**Captions:** A "Quote analytics: the whole funnel." · B "✦ Claude insights: advisory, on screen only."
**Emphasis:** *funnel*, *advisory*.

### 14 · Beyond the core loop · 3:05–3:23

**On screen:** Three quick cuts, 6 s each. (a) A product page on the store with the
"Add to Quote" and "Make an Offer" buttons visible, a request submitted, then Mannon →
Quotes → Requests showing it. (b) Settings: Reorder auto-approve tolerance, Quote expiry
days. (c) Pricing plans page, then Shopify's "Select a plan" page. No plan names or prices
are spoken.

**VO**
```
Storefront blocks...
Request a Quote, Add to Quote, Make an Offer,
and they show up the moment you add them.

Settings you own...
reorder tolerance, quote expiry.

And plans are billed by Shopify,
on Shopify's own plan page.
```
**Captions:** A "Storefront blocks: Request a Quote, Add to Quote, Make an Offer." · B "Settings you own. Billing handled by Shopify."
**Emphasis:** *storefront*, *moment*, *Shopify's own*.

### 15 · Try the demo · 3:23–3:46

**On screen:** Landing page, "Try before you install" strip → "Open the buyer demo". The
demo hub "See the whole workflow. No install, no sign-up." Then the live portal "Welcome,
Demo buyer" with a Countered quote and a reorder card. Accept → confirm → Ordered. Last
6 s: the resulting draft order in the demo store's admin.

**VO**
```
Want to try it before installing?
Go to manosh dot fly dot dev,
and click Open the buyer demo.

No install, no sign-up.

You're a sample buyer on our demo store,
with a countered quote
and a reorder card from a real order.

Accept it... confirm it...
and watch it become a Shopify draft order.

That's the whole loop,
and you just did it yourself.
```
**Captions:** A "Try before you install: manosh.fly.dev → Open the buyer demo." · B "Quote → Accept → Reorder, on native Shopify draft orders."
**Emphasis:** *demo*, *no install*, *real order*, *yourself*.

### 16 · Close · 3:46–4:00

**On screen:** Logo card: mark + wordmark, accent lines "Quote → Accept → Reorder, on
native Shopify draft orders" and "✦ Claude drafts · you stay in control". 2 % zoom, fade to
end.

**VO**
```
Mannon.
Quote, accept, reorder,
on native Shopify draft orders.

Claude drafts.
You stay in control.

Built on Shopify's native B2B,
and every price comes from Shopify.
```
**Captions:** A "Quote → Accept → Reorder, on native Shopify draft orders." · B "✦ Claude drafts · you stay in control."
**Emphasis:** *native*, *control*. The last line falls and settles.

---

## Voice-only script (for Menna, or for TTS)

One phrase per line, `...` is a 0.5 s beat, a blank line is a 1 s beat. Read at about 150
words a minute, warm, calm, a small smile on the light lines ("the fun part", "okay, weeks
later"). Lift the key noun in each line; let every last line fall. Spell the address as
"manosh dot fly dot dev". Say "Net thirty", "B two B", "PO" as the letters, "PO" as the letters.

```
Wholesale quoting...
without the email grind.

This is Mannon,
a B2B quoting app for Shopify.

It runs on Shopify's own B2B,
companies, catalogs, payment terms,
and every price comes from Shopify.

Mannon lives inside your Shopify admin.

Everything is in one place...
quotes, buyers, analytics, settings.

So let me show you the whole flow,
from a quote to a reorder.

Home is your morning view.

How many quotes came in,
how many were accepted,
and what still needs you today.

This is the quote inbox.

Every request from a buyer lands here,
with its status...
New, Countered, Ordered.

So let's open one.

Here's the quote.

And look at this card...
Totals from Shopify.

Subtotal, tax, total.
Mannon never calculates money itself.

It asks Shopify,
and Shopify answers for this buyer's company.

Now the fun part.

Click... Draft all lines with Claude.

Claude drafts a counter price for each line.

But here's the rule.
Claude only drafts.
You pick "Use this price", line by line,
and nothing is sent until you say so.

Happy with it?
Click Send counter.

The status flips to Countered,
and the buyer gets the news.

That's it. No email to write.

How does the buyer get in?
No password. A magic link.

Go to Buyers,
click Generate link,
and copy it.

One link, one buyer,
and it expires on its own.

This is what the buyer sees.
No login screen.

They open the countered quote,
pick their payment terms...
Net thirty.

Then Accept and create order.

And then, a confirm panel.
Nothing is written until they confirm.

They confirm...
and the quote is Ordered,
with Shopify's tax and total.

So where did the order go?
Straight into Shopify.

Orders, Drafts, and there it is.
A real Shopify draft order,
with the PO number,
the company, and the net terms.

Weeks later,
the buyer wants the same thing again.

So, on their portal,
Reorder a past order.
One tap.

Shopify re-prices it today.
Within your tolerance, it's a draft order.
Otherwise, it waits for you to review.

Buyers can paste a whole PO,
and click Read my order.

Claude matches every line
to a real product in your catalog.

Every id is checked against Shopify.
The buyer confirms,
then a quote exists.

Analytics shows your quote funnel.

And Claude insights reads it with you...
win rate, credit risk, a buyer summary.

Advisory only, on screen only.
It never changes anything.

Storefront blocks...
Request a Quote, Add to Quote, Make an Offer,
and they show up the moment you add them.

Settings you own...
reorder tolerance, quote expiry.

And plans are billed by Shopify,
on Shopify's own plan page.

Want to try it before installing?
Go to manosh dot fly dot dev,
and click Open the buyer demo.

No install, no sign-up.

You're a sample buyer on our demo store,
with a countered quote
and a reorder card from a real order.

Accept it... confirm it...
and watch it become a Shopify draft order.

That's the whole loop,
and you just did it yourself.

Mannon.
Quote, accept, reorder,
on native Shopify draft orders.

Claude drafts.
You stay in control.

Built on Shopify's native B2B,
and every price comes from Shopify.
```

---

## Producing the audio (ElevenLabs, only with Menna's written consent)

| Setting | Value (from `voice_profile.json`) |
|---|---|
| Clone | Instant Voice Clone from `samples/00_Menna_voice_clone_reference.mp3` (≈ 4.8 min) |
| Model | `eleven_multilingual_v2` |
| Stability / Similarity / Style | 0.50 / 0.80 / 0.10, speaker boost on, speed 1.0 |
| Generation | One request per scene (16 files), so a wrong take is re-done alone |
| Post | Normalise to −16 LUFS integrated, peaks under −1 dBTP; Voice Isolator only if needed |
| Check | Listen to every scene. Re-generate any line where "Mannon", "Shopify", "SKUs" or "manosh dot fly dot dev" sounds wrong |

If Menna records it herself: same script, same beats, clean with Voice Isolator, normalise
to −16 LUFS. That is the better version.

---

## Recording the screens (Mac, signed-in Chrome on port 9222)

Record each scene as its own clip, 1920×1080, 30 fps, in the order of the timing table.
Hold each clip at least 2 s longer than its slot so the edit has room.

- Admin scenes (2–8, 10, 13, 14b, 14c): the real Shopify admin frame, in the Chrome profile
  that is signed in. Use the demo buyer's quotes so the data matches the narration.
- Buyer scenes (9, 11, 12, 15): a separate private context in the same Chrome, with the
  "Incognito" tag added in the edit. The quote in scene 9 must be the one countered in
  scene 7.
- Scene 8: blur the magic link in the edit. After recording, generate a new link so the one
  on film is dead.
- Scene 14a: the live product page via the theme editor's View link (the storefront is
  password-protected), never by typing the storefront password on camera.
- Scene 15: a fresh private window, a brand-new demo buyer, and the demo store's Orders →
  Drafts for the last 8 s.
- Afterwards, delete the draft orders and held reorder quotes the recording created. Keep
  order #1001; the demo's reorder card depends on it.

Edit to `docs/brand.md` §9: cross-fades, 2 % Ken Burns, soft cursor, click ripple timed to
the VO, lower-third captions from this script, progress bar, no music. Export
`mannon-walkthrough-menna.mp4`, 1920×1080, H.264, AAC, faststart, under 30 MB, and upload
Unlisted per `SUBMISSION-KIT.md` → "Uploading the screencast".
