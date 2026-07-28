-- Feature 7: Quote Analytics & Sales Dashboard.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'ANALYTICS_VIEWED';

-- AlterTable: weekly digest opt-in
ALTER TABLE "Shop" ADD COLUMN "weeklyDigest" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "QuoteMetricDaily" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quotesCreated" INTEGER NOT NULL DEFAULT 0,
    "quotesWon" INTEGER NOT NULL DEFAULT 0,
    "quotesLost" INTEGER NOT NULL DEFAULT 0,
    "quotesExpired" INTEGER NOT NULL DEFAULT 0,
    "quoteValueTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountPctAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timeToCloseHrsAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteMetricDaily_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "QuoteMetricDaily_shopId_date_key" ON "QuoteMetricDaily"("shopId", "date");
CREATE INDEX "QuoteMetricDaily_shopId_date_idx" ON "QuoteMetricDaily"("shopId", "date");

-- Foreign keys
ALTER TABLE "QuoteMetricDaily" ADD CONSTRAINT "QuoteMetricDaily_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
