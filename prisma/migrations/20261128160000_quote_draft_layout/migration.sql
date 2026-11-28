-- Phase 3: quote detail on Shopify's draft-order layout. New nullable columns
-- only; no existing data changes.
ALTER TABLE "Quote" ADD COLUMN "adjustments" JSONB;
ALTER TABLE "Quote" ADD COLUMN "buyerMessage" TEXT;
ALTER TABLE "Quote" ADD COLUMN "internalNote" TEXT;
