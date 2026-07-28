# Feature 20 — White-Label / Agency Multi-Store Management

Let agencies and multi-brand sellers manage Mannon across several stores from one
place, with light white-labeling of the buyer portal. **Growth-only Agency
add-on**, dark-launched behind `MANNON_FF_WHITE_LABEL`. When the flag is off, the
admin route 404s and the buyer portal always uses the Mannon brand.

## Surfaces

| Route | Who | Purpose |
|---|---|---|
| `/app/agency` | Merchant/agency (embedded) | Create the org, link stores, cross-store rollups, per-store white-label |
| Buyer portal (`/portal/*`) | Buyer | Repaints in the store's brand when a `Branding` record exists |

## Data model (migration `f20_white_label`)

- `Organization { id, name, ownerEmail }`
- `OrgStore { id, org, shop, role(OWNER|MANAGER|VIEWER) }` — `shop` is the shopifyDomain, `@@unique([shop])` (a store belongs to at most one org).
- `Branding { id, shop @unique, logoFileId?, primaryColor?, accentColor?, portalName? }` — buyer-facing overrides only.
- `EventType` += `ORG_CREATED`, `STORE_LINKED`, `BRANDING_UPDATED`.

## The three guardrails

1. **Per-store data isolation.** Cross-store rollups reuse `getDashboardMetrics(shopId)`
   **once per store, scoped strictly to that store's `shopId`** (`getOrgRollup`). No
   query joins across stores; the org only stores membership metadata. Data never
   crosses stores.
2. **White-label never touches the admin.** `Branding` is applied only on the buyer
   portal shell (`portal.tsx` injects `--accent`/`--link`/`--lime` CSS variables +
   an optional logo/name bar) and in email wording. The embedded Shopify admin stays
   Mannon/Polaris.
3. **Billing is still per-store via Shopify.** The org view is **management-only** —
   never a billing bypass. Creating an org and linking a store both require the store
   to be on its own **Growth** plan (`agencyAllowed(shop.plan)` checked against the
   real `Shop.plan`). Each managed store keeps its own Shopify subscription.

## Accessibility (contrast)

A client's colors pass through `validateBranding`, which rejects a primary that
can't reach **AA (4.5:1)** against its auto-chosen text color (`readableTextOn`
picks white or ink). So buttons stay legible whatever brand color is supplied.

## Switch without re-login

Each connected store row has an **Open** link to
`https://admin.shopify.com/store/<handle>/apps`. The agency member is already a
Shopify staff user on the store, so Mannon rides that Shopify session — org-scoped
navigation with no separate Mannon login. Role-based: `canManage(role)` (OWNER/
MANAGER) gates linking/unlinking and branding; VIEWER is read-only.

## Plan gating

Growth-only. `agencyAllowed(plan)` gates org creation + store linking;
`whiteLabelAllowed(plan)` gates branding. Starter/solo merchants see an upgrade CTA
(`AGENCY_UPGRADE_MESSAGE`), not the feature.

## Deploy hand-off

The container can't reach a store, so after merge:

1. Set `MANNON_FF_WHITE_LABEL=true`.
2. Run the `f20_white_label` migration (`prisma migrate deploy`).
3. Smoke-test the acceptance lines: create an org on a Growth store → link a second
   Growth store → see combined rollups → **Open** each without re-login → set a
   client logo/colors and confirm only that store's **buyer portal** repaints (admin
   unchanged) → confirm a Starter store never sees `/app/agency`.
