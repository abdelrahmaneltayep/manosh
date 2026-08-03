-- Feature 21: Make an Offer / Name Your Price (PR-3 core).

-- AlterEnum: offer lifecycle events.
ALTER TYPE "EventType" ADD VALUE 'OFFER_CREATED';
ALTER TYPE "EventType" ADD VALUE 'OFFER_COUNTERED';
ALTER TYPE "EventType" ADD VALUE 'OFFER_ACCEPTED';
ALTER TYPE "EventType" ADD VALUE 'OFFER_DECLINED';
ALTER TYPE "EventType" ADD VALUE 'OFFER_CONVERTED';
ALTER TYPE "EventType" ADD VALUE 'OFFER_RULE_UPDATED';

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('PRODUCT', 'CART', 'ORDER');
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED');
CREATE TYPE "OfferActor" AS ENUM ('BUYER', 'MERCHANT', 'SYSTEM');
CREATE TYPE "OfferHandledBy" AS ENUM ('AUTO', 'MANUAL');
CREATE TYPE "OfferRuleScope" AS ENUM ('ALL', 'COLLECTION', 'PRODUCT', 'CUSTOMER_GROUP');

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "companyId" TEXT,
    "source" "OfferSource" NOT NULL DEFAULT 'PRODUCT',
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "lineItems" JSONB NOT NULL,
    "listPriceTotal" DECIMAL(12,2) NOT NULL,
    "offeredTotal" DECIMAL(12,2) NOT NULL,
    "currentCounterTotal" DECIMAL(12,2),
    "marginAtOffer" DECIMAL(6,4),
    "ruleId" TEXT,
    "handledBy" "OfferHandledBy",
    "expiresAt" TIMESTAMP(3),
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferMessage" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "actor" "OfferActor" NOT NULL,
    "amountTotal" DECIMAL(12,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "OfferRuleScope" NOT NULL DEFAULT 'ALL',
    "scopeRef" TEXT,
    "minAcceptPctOfList" DECIMAL(5,4) NOT NULL,
    "autoDeclineBelowPctOfList" DECIMAL(5,4) NOT NULL,
    "autoCounterToPctOfList" DECIMAL(5,4),
    "marginFloorPct" DECIMAL(5,4) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfferRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferWidgetConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "surfaces" JSONB NOT NULL DEFAULT '{"button":true,"banner":false,"inlineForm":true,"exitPopup":false}',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Make an offer',
    "hideAtcUntilOffer" BOOLEAN NOT NULL DEFAULT false,
    "styleTokens" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferWidgetConfig_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Offer_shopId_status_idx" ON "Offer"("shopId", "status");
CREATE INDEX "Offer_shopId_createdAt_idx" ON "Offer"("shopId", "createdAt");
CREATE INDEX "OfferMessage_offerId_idx" ON "OfferMessage"("offerId");
CREATE INDEX "OfferRule_shopId_active_priority_idx" ON "OfferRule"("shopId", "active", "priority");
CREATE UNIQUE INDEX "OfferWidgetConfig_shopId_key" ON "OfferWidgetConfig"("shopId");

-- Foreign keys
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferMessage" ADD CONSTRAINT "OfferMessage_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferRule" ADD CONSTRAINT "OfferRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferWidgetConfig" ADD CONSTRAINT "OfferWidgetConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
