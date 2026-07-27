-- Feature 1: AI Quote Assistant (Growth-only).
-- Adds the floor-margin setting, a cached variant-cost table for real margin
-- math, the AI suggestion record, and the AI_SUGGESTION_USED event type.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'AI_SUGGESTION_USED';

-- AlterTable: floor-margin setting on the shop (default 15%).
ALTER TABLE "Shop" ADD COLUMN "minMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 0.15;

-- CreateTable: cached wholesale cost per variant (Shopify inventoryItem.unitCost).
CREATE TABLE "VariantCost" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "costPrice" DECIMAL(18,4),
    "currencyCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one row per AI suggestion (line-level or quote-level).
CREATE TABLE "QuoteAiSuggestion" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "lineId" TEXT,
    "suggestedPrice" DECIMAL(18,4) NOT NULL,
    "floorPrice" DECIMAL(18,4) NOT NULL,
    "marginPct" DOUBLE PRECISION,
    "belowFloor" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT NOT NULL,
    "draftMessage" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteAiSuggestion_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "VariantCost_shopId_variantId_key" ON "VariantCost"("shopId", "variantId");
CREATE INDEX "VariantCost_shopId_idx" ON "VariantCost"("shopId");
CREATE INDEX "QuoteAiSuggestion_quoteId_lineId_createdAt_idx" ON "QuoteAiSuggestion"("quoteId", "lineId", "createdAt");

-- Foreign keys
ALTER TABLE "VariantCost" ADD CONSTRAINT "VariantCost_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteAiSuggestion" ADD CONSTRAINT "QuoteAiSuggestion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
