# Mannon

B2B wholesale quoting + one-tap reorder for Shopify merchants, built on native
B2B (companies, catalogs, payment terms). Embedded Shopify Admin app (Remix +
App Bridge + Polaris), pricing on **draft orders** — we never rebuild what
Shopify already owns.

> Read [`CLAUDE.md`](./CLAUDE.md) and the relevant [`/docs`](./docs) before
> building. One slice per session — see the feature-slices plan.

## Stack

Remix (TypeScript) · Polaris + App Bridge · Prisma + **Postgres** · Prisma
session storage · Vitest. See `CLAUDE.md` for the full tech stack and the
slice map.

## Prerequisites

- Node `>=20.19 <22 || >=22.12`
- A Postgres database (set `DATABASE_URL`)
- A [Shopify Partner](https://partners.shopify.com) account + a development
  store with B2B enabled
- The [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) (`shopify`)

## Local setup

```bash
npm install
cp .env.example .env        # fill in values (CLI injects most in dev)
npx prisma generate
npx prisma migrate deploy   # requires DATABASE_URL to point at a live Postgres
npm run dev                 # `shopify app dev` — tunnels + installs on your dev store
```

`npm run dev` runs `shopify app dev`, which creates a tunnel, links the app to
your Partner app, and installs it on your development store. The app renders
**embedded** inside Shopify Admin.

## Verifying S1 (embedded scaffold) on a dev store

The CI container can't reach a Shopify store, so these steps are manual:

1. `npm run dev`, choose/create your Partner app + dev store when prompted.
2. Press `p` to open the app — it should load **inside Shopify Admin** (an
   embedded iframe), not as a standalone browser tab.
3. Confirm the Polaris page renders ("Welcome to Mannon") with the **Home** nav
   item in the embedded app nav.
4. Visit `https://<your-tunnel-host>/healthz` → returns `ok` (200).
5. Uninstall/reinstall the app → session is restored (Prisma session storage).

## What the container CAN verify (no store needed)

```bash
npm install
npx prisma generate
npm run build       # remix vite:build — compiles the app
npm test            # vitest — /healthz test green
npm run typecheck   # tsc --noEmit
```

## Health check

`GET /healthz` → `200 ok`. Dependency-free (no DB, no Shopify) so it reflects
process liveness only.

## Project layout

See the "Repo layout" section of [`CLAUDE.md`](./CLAUDE.md). Domain logic lives
in `app/services/*` (UI-free, unit-tested); routes stay thin.
