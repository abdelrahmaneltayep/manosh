# /docs/data-model.md — Mannon data model (§3.5)

The Prisma schema below is the contract S2 implements exactly. Entities: **Shop, Session, Company,
Buyer, Quote, QuoteLine, ReorderSource, Event**, plus **StaffSeat** (added later to gate the
Starter/Growth seat cap — one row per invited staff email, `@@unique([shopId, email])`).

## Principles

- **Event is append-only.** Written only through `app/services/events.server.ts` (insert-only). No
  `update`/`delete` on `Event` anywhere in application code. Every state change appends an Event.
- **PII lives on `Buyer`** (email, name) and inside `QuoteLine`/snapshots. GDPR redaction targets it
  precisely — see `/docs/compliance.md` for the cascade.
- **Money is snapshotted, never computed.** `Quote.totalsSnapshot` holds exactly what
  `draftOrderCalculate` returned (subtotal, tax, total, currency). We never recompute.
- **Secrets are hashed.** `Buyer.magicTokenHash` stores `sha256(token)`; the raw token exists only in
  the emailed link. Magic links are **single-use** — consuming one is an atomic conditional update
  (`app/services/magic-link.server.ts`), so replays and email link-scanner requests are rejected.
  Link lifetime is the shop's `magicLinkExpiryDays` setting. The buyer portal session is a separate
  signed HTTP-only cookie (`app/services/buyer-session.server.ts`), independent of the Shopify admin
  session.
- **Shopify ids are GIDs**, stored verbatim (`gid://shopify/...`).

## Cascade / ownership

```
Shop 1─* Company 1─* Buyer
Shop 1─* Company 1─* Quote 1─* QuoteLine
Shop 1─* Company 1─* ReorderSource
Shop 1─* Event   (denormalized shopId for fast per-shop reads)
Quote *─1 Buyer  (who raised it)
```

- `shop/redact` → delete everything under the Shop (Companies, Buyers, Quotes, QuoteLines,
  ReorderSources, Events, Session).
- `customers/redact` → delete the matching Buyer and their Quotes/QuoteLines PII.
- `app/uninstalled` → delete Session + Shop-scoped data per compliance doc.

## schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Shopify session storage (Prisma). Survives reinstall.
model Session {
  id            String    @id
  shop          String
  state         String
  isOnline      Boolean   @default(false)
  scope         String?
  expires       DateTime?
  accessToken   String
  userId        BigInt?
  firstName     String?
  lastName      String?
  email         String?
  accountOwner  Boolean   @default(false)
  locale        String?
  collaborator  Boolean?  @default(false)
  emailVerified Boolean?  @default(false)
}

model Shop {
  id                    String   @id @default(cuid())
  shopifyDomain         String   @unique          // e.g. acme.myshopify.com
  plan                  Plan     @default(TRIAL)
  trialEndsAt           DateTime?
  autoApproveTolerance  Float    @default(0)      // reorder auto-convert tolerance, fraction (0.05 = 5%)
  quoteExpiryDays       Int      @default(14)     // default quote lifetime
  magicLinkExpiryDays   Int      @default(7)      // how long a buyer magic link stays valid
  installedAt           DateTime @default(now())
  companies             Company[]
  events                Event[]
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model Company {
  id                String         @id @default(cuid())
  shopId            String
  shop              Shop           @relation(fields: [shopId], references: [id], onDelete: Cascade)
  shopifyCompanyId  String                          // gid://shopify/Company/...
  name              String
  buyers            Buyer[]
  quotes            Quote[]
  reorderSources    ReorderSource[]
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  @@unique([shopId, shopifyCompanyId])
  @@index([shopId])
}

model Buyer {
  id                 String    @id @default(cuid())
  companyId          String
  company            Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  email              String                          // PII
  name               String?                         // PII
  shopifyContactId   String?                         // gid://shopify/CompanyContact/...
  shopifyCompanyLocationId String?                   // gid://shopify/CompanyLocation/... — the location this buyer purchases for (S8 purchasingEntity)
  magicTokenHash     String?                         // hash only, never raw
  magicTokenExpiresAt DateTime?
  quotes             Quote[]
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@unique([companyId, email])
  @@index([magicTokenHash])
}

model Quote {
  id               String      @id @default(cuid())
  companyId        String
  company          Company     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  buyerId          String
  buyer            Buyer       @relation(fields: [buyerId], references: [id], onDelete: Cascade)
  status           QuoteStatus @default(SUBMITTED)
  expiresAt        DateTime
  poReference      String?
  draftOrderId     String?                          // gid://shopify/DraftOrder/... (set on accept)
  totalsSnapshot   Json?                            // exact draftOrderCalculate output
  lines            QuoteLine[]
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  @@index([companyId, status])
  @@index([status, expiresAt])
}

model QuoteLine {
  id          String  @id @default(cuid())
  quoteId     String
  quote       Quote   @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  variantId   String                               // gid://shopify/ProductVariant/...
  sku         String?
  title       String                               // snapshot for display / PII-adjacent
  quantity    Int
  price       Decimal @db.Decimal(18, 4)           // buyer-proposed or countered unit price
  createdAt   DateTime @default(now())

  @@index([quoteId])
}

model ReorderSource {
  id               String   @id @default(cuid())
  companyId        String
  company          Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  shopifyOrderId   String                          // gid://shopify/Order/...
  orderName        String                          // e.g. #1042
  orderedAt        DateTime
  total            String                          // snapshot string + currency below
  currency         String
  createdAt        DateTime @default(now())

  @@unique([companyId, shopifyOrderId])
  @@index([companyId])
}

// APPEND-ONLY. Written only via events.server.ts insert helper.
model Event {
  id          String    @id @default(cuid())
  shopId      String
  shop        Shop      @relation(fields: [shopId], references: [id], onDelete: Cascade)
  type        EventType
  entityType  String                                // "Quote" | "Buyer" | "ReorderSource" | ...
  entityId    String?
  payload     Json?                                 // NO PII in payload — ids + numbers only
  createdAt   DateTime  @default(now())

  @@index([shopId, type, createdAt])
}

enum Plan {
  TRIAL
  STARTER   // $29
  GROWTH    // $79
  CANCELLED
}

enum QuoteStatus {
  SUBMITTED
  COUNTERED
  ACCEPTED
  ORDERED
  EXPIRED
}

enum EventType {
  APP_INSTALLED
  QUOTE_SUBMITTED
  QUOTE_COUNTERED
  QUOTE_ACCEPTED
  QUOTE_ORDERED
  QUOTE_EXPIRED
  REORDER_CREATED
  DRAFT_ORDER_CREATED
  AI_PARSE_ACCEPTED
  TRIAL_STARTED
  PLAN_UPGRADED
  PLAN_CANCELLED
  REVIEW_PROMPT_SHOWN
}
```

## Seed (S2)

`prisma/seed.ts` creates: one demo `Shop`, one `Company`, one `Buyer`, and one `ReorderSource`
pointing at a fake past order — so downstream slices (portal, reorder, dashboard) have data. The seed
must be idempotent and a test asserts it runs and all relations resolve.

## Notes for the build session (confirm via Dev MCP)

- Field names on `purchasingEntity` (company + location + contact) for `draftOrderCreate` — **confirm
  against the current API version** before S8.
- Exact `Session` model shape is dictated by `@shopify/shopify-app-session-storage-prisma`; match its
  current expected columns rather than the sketch above if they differ.
