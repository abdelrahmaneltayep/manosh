-- Feature 8: Automated Quote Follow-ups, Expiry & Reminders.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'FOLLOWUP_SENT';

-- CreateEnum
CREATE TYPE "FollowupKind" AS ENUM ('REMINDER', 'EXPIRY_WARNING', 'EXPIRED');
CREATE TYPE "FollowupChannel" AS ENUM ('EMAIL');
CREATE TYPE "FollowupStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "timezone" TEXT;
ALTER TABLE "Quote" ADD COLUMN "reminderState" JSONB;

-- CreateTable
CREATE TABLE "FollowupPolicy" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "expiryDays" INTEGER NOT NULL DEFAULT 14,
    "cadenceDays" INTEGER[],
    "maxNudges" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowupPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuoteFollowup" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "kind" "FollowupKind" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "channel" "FollowupChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "FollowupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteFollowup_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "FollowupPolicy_shopId_key" ON "FollowupPolicy"("shopId");
CREATE INDEX "QuoteFollowup_quoteId_idx" ON "QuoteFollowup"("quoteId");
CREATE INDEX "QuoteFollowup_status_scheduledFor_idx" ON "QuoteFollowup"("status", "scheduledFor");

-- Foreign keys
ALTER TABLE "FollowupPolicy" ADD CONSTRAINT "FollowupPolicy_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteFollowup" ADD CONSTRAINT "QuoteFollowup_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
