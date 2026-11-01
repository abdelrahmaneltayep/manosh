# Security incident response — Mannon

Short, honest, and followed. Referenced from the Partner Dashboard
"Data protection details" answer ("Do you have a security incident response policy?").

## What counts as an incident

- Any suspected unauthorised access to the production database, the Fly app, or a secret
  (`SHOPIFY_API_SECRET`, `ANTHROPIC_API_KEY`, `MANNON_ENCRYPTION_KEY`, `DATABASE_URL`).
- A magic link or session that lets a buyer see another company's data.
- A webhook accepted without a valid HMAC.
- A leaked credential in a commit, log, screenshot, or chat.

## Steps (owner: the developer, abdelrahmaneltayep@gmail.com)

1. **Contain within 1 hour.** Rotate the affected secret (`fly secrets set …`), revoke sessions
   (`DELETE FROM "Session"` for the shop, or all), invalidate magic links (`magicTokenHash` reset).
2. **Assess within 24 hours.** From Fly logs and Sentry, work out which shops and buyers were
   affected and which fields (name, email, order ids and totals, quote lines).
3. **Notify within 72 hours.** Email every affected merchant with what happened, which data, and
   what was done. Merchants notify their buyers. Shopify Partner Support is told when customer
   data from a Shopify store is involved.
4. **Fix and verify.** Patch, add a regression test, deploy, and re-run `npm run qa`.
5. **Record.** Append a dated entry to the log below.

## Access and logging

- Only the developer has access to Fly, the database, Sentry and the Partner Dashboard,
  each behind two-step verification.
- Personal data is read only by the app on behalf of the merchant; there is no admin
  console that browses buyer data. Request logs on Fly keep who-did-what for 30 days.

## Incident log

| Date | What | Impact | Action |
|---|---|---|---|
| — | none recorded | — | — |
