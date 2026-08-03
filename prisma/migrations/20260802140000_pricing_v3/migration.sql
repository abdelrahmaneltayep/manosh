-- Pricing v3 (PR-1): 4-plan ladder + grandfathering.

-- AlterEnum: add the FREE and SCALE tiers.
ALTER TYPE "Plan" ADD VALUE 'FREE';
ALTER TYPE "Plan" ADD VALUE 'SCALE';

-- AlterTable: grandfathering — a shop kept on pre-v3 pricing carries its legacy
-- price so billing never silently raises anyone.
ALTER TABLE "Shop" ADD COLUMN "legacyPlan" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN "legacyPriceCents" INTEGER;
