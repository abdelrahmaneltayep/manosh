# Built-for-Shopify — Design (§3.3, PR-6)

BFS grades design on how *native* the app feels inside the admin: Polaris
throughout, App Bridge navigation + contextual Save Bar, and designed
empty/loading/error states (never a blank table or raw stack trace). This
documents each bar, where it's met, and a re-runnable audit.

## Polaris everywhere, App Bridge shell

- Every admin screen renders inside Polaris `Page`/`Card`/`BlockStack` with an
  App Bridge `TitleBar`; the embedded frame is App Bridge (`AppProvider`,
  `app/routes/app.tsx`). No custom UI where Polaris has a pattern (guardrail #5).
- **App Bridge nav menu** (`<NavMenu>` in `app.tsx`) lists every top-level surface
  (Home, Quotes, Requests, Offers, …, Settings) — no dead links, no bespoke nav.

## Contextual Save Bar on settings-style forms

- The F21 **Make-an-Offer widget** form (`/app/offers/widget`) uses the App Bridge
  **`SaveBar`**: editing any control marks the form dirty and reveals the Save /
  Discard bar; Save submits, Discard restores the last-saved values. Dirty state is
  a pure diff of the form against the loaded config, so the bar is honest — it
  shows only when there are real unsaved changes. This is the sanctioned Shopify
  pattern for "you have unsaved changes", replacing an inline Save button.
- Same refactor removed a latent form bug: the checkboxes previously carried both a
  Polaris `name` **and** a shadow hidden `<input>` of the same name (a double
  submit). State is now the single source of truth, serialized on save.

## Designed empty / error states — never blank, never raw

- **Empty states** use Polaris `EmptyState` with a real illustration + a
  next-action sentence. PR-6 fixed three that rendered a **broken `image=""`**
  (Offers, Catalog sharing, Agency) to the standard Shopify empty-state
  illustration, matching the rest of the app. Audit (should print nothing):
  `grep -rn 'image=""' app/routes/`.
- **List surfaces** set `IndexTable` `itemCount` and only render rows when present;
  the top-level landings (Offers, Quotes, Requests, Buyers, Catalogs, …) each have
  a designed empty state, and secondary sub-tables (fx rates, installments) are
  conditionally rendered behind their own add-form/plan context.
- **Error + success feedback** is always a plain-language Polaris `Banner` (tone
  `critical`/`success`/`info`), never a raw error. Audit: every offers route
  surfaces `actionData.error` / `actionData.message` as a `Banner`.

## Accessibility (carried from S16)

Keyboard-navigable end to end, screen-reader labels on controls, AA contrast —
Polaris gives this by default and the a11y polish slice (S16) verified it. The
SaveBar and EmptyState changes here keep to Polaris/App Bridge primitives, so they
inherit the same guarantees.

## Result

Polaris + App Bridge shell with a complete nav menu ✓ · contextual Save Bar on the
Make-an-Offer settings form (dirty-tracked) ✓ · designed empty states with real
illustrations (no broken images) ✓ · plain-language `Banner` error/success
feedback ✓.
