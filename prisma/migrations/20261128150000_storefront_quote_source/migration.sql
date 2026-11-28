-- Phase 3: storefront requests become quotes. Quotes already created from a
-- storefront request are labelled with the storefront source (WIDGET).
-- Data only, no schema change. Safe to run twice: it only touches quotes still
-- on the default PORTAL source that a request points to.
UPDATE "Quote" q
SET "source" = 'WIDGET'
FROM "QuoteRequest" r
WHERE r."convertedQuoteId" = q."id"
  AND q."source" = 'PORTAL';
