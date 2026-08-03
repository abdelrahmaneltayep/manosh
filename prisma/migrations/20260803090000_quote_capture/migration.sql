-- Feature 24.1: Storefront Quote Capture — custom quote form builder.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'QUOTE_FORM_UPDATED';

-- CreateEnum
CREATE TYPE "QuoteFormSurface" AS ENUM ('PRODUCT', 'COLLECTION', 'CART', 'PAGE');

-- CreateTable
CREATE TABLE "QuoteForm" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "surface" "QuoteFormSurface" NOT NULL DEFAULT 'PRODUCT',
    "fields" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteForm_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "QuoteForm_shopId_active_idx" ON "QuoteForm"("shopId", "active");

-- AlterTable — link submissions + converted quotes back to the form used.
ALTER TABLE "QuoteRequest" ADD COLUMN "formId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "formId" TEXT;

-- Foreign keys
ALTER TABLE "QuoteForm" ADD CONSTRAINT "QuoteForm_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_formId_fkey" FOREIGN KEY ("formId") REFERENCES "QuoteForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_formId_fkey" FOREIGN KEY ("formId") REFERENCES "QuoteForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
