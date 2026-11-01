# Data protection details — the answers given to Shopify

Recorded so the Partner Dashboard form, `docs/compliance.md` and the privacy page stay in step.
Change the code or the hosting and change this file.

| Question | Answer | Why it is true |
|---|---|---|
| Process the minimum personal data | Yes | Name and email of buyers, company contact ids, order ids and totals. No phone, no address. |
| Tell merchants what is processed and why | Yes | `/privacy` page and the listing's privacy URL list every field and purpose. |
| Limit use to that purpose | Yes | Email only for magic-link sign-in and quote notifications; never marketing. |
| Privacy agreements with merchants | Yes | The privacy policy at `/privacy` is the merchant-facing agreement, accepted at install. |
| Respect customer consent decisions | Not applicable | Mannon sends no marketing and tracks no visitors; buyers opt in by requesting a quote. |
| Respect opt-out of data sale | Not applicable | Data is never sold or shared for value. |
| Automated decisions with legal effect, opt-out | Not applicable | AI only pre-fills screens; a person confirms every write. No credit decisions are automated. |
| Retention periods | Yes | `docs/compliance.md` → Data retention; `shop/redact` and `customers/redact` erase on request. |
| Encrypt at rest and in transit | Yes | Fly.io volumes are encrypted at rest; all traffic is TLS; tokens are hashed or AES-256-GCM encrypted. |
| Encrypt backups | Yes | Fly Postgres snapshots inherit the encrypted volume. |
| Separate test and production data | Yes | Dev store + local Postgres for tests; production database only on Fly. |
| Data loss prevention strategy | Yes | Daily Fly Postgres snapshots, append-only events, secrets only in Fly. |
| Limit staff access | Yes | One developer; no staff, no shared accounts. |
| Strong staff passwords | Yes | Two-step verification on Shopify Partners, Fly, GitHub and Sentry. |
| Log access to personal data | Yes | Fly request logs (30 days) plus Sentry; no separate admin browsing of buyer data exists. |
| Security incident response policy | Yes | `docs/security-incident-response.md`. |
| Third-party audits or certifications | None | Leave blank; do not claim SOC 2. |
