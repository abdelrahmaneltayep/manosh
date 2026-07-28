# Feature 18 — Buyer PWA & One-Tap Reorder (Installable Mobile)

Make the magic-link buyer portal an **installable Progressive Web App** so repeat
buyers add the store to their phone's home screen and reorder their usual order in
one tap. Both plans (partial by capability), dark-launched behind
`MANNON_FF_BUYER_PWA`. **Progressive enhancement** — when the flag is off (or the
browser doesn't support service workers), the portal is unchanged and every PWA
route 404s.

## What ships

| Route | Serves |
|---|---|
| `/portal/manifest.webmanifest` | Web app manifest (brand tokens, named after the buyer's shop), `application/manifest+json` |
| `/portal/sw.js` | The service worker (scope `/portal/`, `Service-Worker-Allowed: /portal/`) |
| `/portal/icon.svg` | The brand app icon (inline SVG, no binary asset checked in) |
| `/portal/shortcuts` | Buyer page: saved shortcuts + one-tap reorder + create/delete + push opt-in |
| `/portal/push/subscribe` (POST) | Save / remove a Web-Push subscription (opt-in) |
| `/portal/pwa/installed` (POST) | Records the `pwa_installed` event from the `appinstalled` listener |
| `/internal/cron/reorder-push` | CRON_SECRET-guarded worker: push reminders (Growth) + email install nudges |

The portal shell (`app/routes/portal.tsx`) links the manifest and registers the SW
**only** when the flag is on and `navigator.serviceWorker` exists (guarded inline
script — no bundle, keeps the light shell).

## Service worker — scope & versioning (guardrail)

- **Scoped** to `/portal/` (the buyer surface only), served with the
  `Service-Worker-Allowed: /portal/` header so the scope is honored.
- **Versioned** cache name `mannon-portal-v${SW_VERSION}` (`app/lib/pwa.ts`). **Bump
  `SW_VERSION`** to ship a new worker — on `activate` it deletes every cache that
  isn't the current one, so buyers never get stale pages.
- **Network-first** for portal navigations (order history stays fresh), falling back
  to cache only when offline. It caches **no PII** beyond what the signed-in buyer
  already sees, and only GET `/portal` requests are handled.

## One-tap reorder

A saved `ReorderShortcut` (or ad-hoc lines) resolves against the buyer's **visible
catalog (F11)** and submits through **`submitBuyerQuote`**, so **MOQ (F9)** and
**price lists (F3)** all apply — a hidden or unavailable SKU is silently dropped and
can never be reordered. Emits **`REORDER_ONECLICK`**. Installs emit **`PWA_INSTALLED`**.

## Push — strictly opt-in

Web-Push reminders are **Growth-only** and **opt-in**: the `Notification.requestPermission()`
prompt fires only when the buyer taps "Turn on reorder reminders" (never on load).
The browser posts its subscription to `/portal/push/subscribe`; delivery is a
**pluggable no-op until VAPID** is configured (`MANNON_VAPID_PUBLIC_KEY` /
`MANNON_VAPID_PRIVATE_KEY` + the `web-push` transport). Install + one-tap reorder
work without any VAPID setup.

## Plan gating (partial by capability)

| Capability | Starter | Growth |
|---|---|---|
| Installable PWA + one-tap reorder | ✓ | ✓ |
| Saved reorder shortcuts | 1 (`reorderShortcutCap`) | Unlimited |
| Web-push reorder reminders | — | ✓ (`pushRemindersAllowed`) |

Pure gating helpers live in `app/lib/billing.ts` (`pushRemindersAllowed`,
`evaluateShortcutAllowance`, `shortcutCapMessage`) and `PLAN_LIMITS.reorderShortcutCap`.

## Data model (migration `f18_buyer_pwa`)

- `PushSubscription { id, memberId → Buyer, endpoint @unique, keys Json, createdAt }`
- `ReorderShortcut { id, memberId → Buyer, label, lines Json, createdAt, updatedAt }`
- `EventType` += `PWA_INSTALLED`, `REORDER_ONECLICK`.

## Deploy hand-off

The container can't reach a store, so after merge:

1. Set `MANNON_FF_BUYER_PWA=true` (and, for push, generate + set the VAPID keys with
   `npx web-push generate-vapid-keys`).
2. Run the `f18_buyer_pwa` migration (`prisma migrate deploy`).
3. Schedule `POST /internal/cron/reorder-push` (weekly is plenty) with the
   `x-cron-secret: $CRON_SECRET` header.
4. Verify on a phone: open the portal → browser offers "Add to Home Screen" → the
   installed app opens to `/portal`; a saved shortcut reorders in one tap; toggling
   reminders shows the permission prompt only after the tap.
