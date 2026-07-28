-- Feature 17: Embedded "Request a Quote" Storefront Widget.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'QUOTE_REQUEST_CREATED';

-- CreateEnum
CREATE TYPE "QuoteRequestSource" AS ENUM ('PDP', 'CART', 'WIDGET');
CREATE TYPE "QuoteRequestStatus" AS ENUM ('NEW', 'CONVERTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "quoteWidgetEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN "quoteWidgetLabel" TEXT;
ALTER TABLE "Shop" ADD COLUMN "quoteWidgetGated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN "quoteWidgetCartEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shop" ADD COLUMN "quoteWidgetCustomFields" JSONB;

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" "QuoteRequestSource" NOT NULL DEFAULT 'PDP',
    "email" TEXT NOT NULL,
    "companyName" TEXT,
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "customFields" JSONB,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'NEW',
    "convertedQuoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "QuoteRequest_convertedQuoteId_key" ON "QuoteRequest"("convertedQuoteId");
CREATE INDEX "QuoteRequest_shopId_status_idx" ON "QuoteRequest"("shopId", "status");

-- Foreign keys
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_convertedQuoteId_fkey" FOREIGN KEY ("convertedQuoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
