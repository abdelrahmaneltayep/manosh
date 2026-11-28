-- Phase 3: a short claim while a quote's draft order is being created, so a
-- double accept (or accept + merchant convert) creates one order. Nullable
-- column only; no existing data changes.
ALTER TABLE "Quote" ADD COLUMN "orderingSince" TIMESTAMP(3);
