-- Feature 24.2: Storefront price / Add-to-Cart visibility rules.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'PRICE_RULE_UPDATED';

-- CreateEnum
CREATE TYPE "PriceVisibilityScope" AS ENUM ('ALL', 'LOGGED_OUT', 'CUSTOMER_TAG', 'PRODUCT', 'COLLECTION');

-- CreateTable
CREATE TABLE "PriceVisibilityRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scope" "PriceVisibilityScope" NOT NULL DEFAULT 'ALL',
    "scopeRef" TEXT,
    "hidePrice" BOOLEAN NOT NULL DEFAULT true,
    "hideAtc" BOOLEAN NOT NULL DEFAULT false,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Request a Quote',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceVisibilityRule_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "PriceVisibilityRule_shopId_active_priority_idx" ON "PriceVisibilityRule"("shopId", "active", "priority");

-- Foreign keys
ALTER TABLE "PriceVisibilityRule" ADD CONSTRAINT "PriceVisibilityRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
