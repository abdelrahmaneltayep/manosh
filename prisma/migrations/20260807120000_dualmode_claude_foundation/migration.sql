-- Dual-mode foundation: the one-time 7-day Claude trial timestamp on Shop, and
-- the append-only AiEvent log (one row per Claude draft call).

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "claudeTrialStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'claude',
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiEvent_shopId_feature_createdAt_idx" ON "AiEvent"("shopId", "feature", "createdAt");

-- AddForeignKey
ALTER TABLE "AiEvent" ADD CONSTRAINT "AiEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
