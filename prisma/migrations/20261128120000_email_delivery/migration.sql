-- Phase 2: per-shop alert addresses and a log of every email Mannon tried to send.
-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "alertEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "template" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" "EmailDeliveryStatus" NOT NULL,
    "error" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailDelivery_shopId_entityType_entityId_idx" ON "EmailDelivery"("shopId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "EmailDelivery_shopId_createdAt_idx" ON "EmailDelivery"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

