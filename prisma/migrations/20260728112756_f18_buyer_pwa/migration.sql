-- Feature 18: Buyer PWA & One-Tap Reorder (Installable Mobile).

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'PWA_INSTALLED';
ALTER TYPE "EventType" ADD VALUE 'REORDER_ONECLICK';

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderShortcut" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReorderShortcut_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_memberId_idx" ON "PushSubscription"("memberId");
CREATE INDEX "ReorderShortcut_memberId_idx" ON "ReorderShortcut"("memberId");

-- Foreign keys
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReorderShortcut" ADD CONSTRAINT "ReorderShortcut_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
