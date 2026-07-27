-- Feature 9: MOQ, Order Minimums & Pack/Case-Size Rules.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'ORDER_RULE_APPLIED';

-- CreateEnum
CREATE TYPE "RuleScope" AS ENUM ('STORE', 'COLLECTION', 'PRODUCT', 'CUSTOMER_GROUP');

-- CreateTable
CREATE TABLE "OrderRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scope" "RuleScope" NOT NULL,
    "targetId" TEXT,
    "minQty" INTEGER,
    "packSize" INTEGER,
    "minOrderValue" DECIMAL(18,4),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderRule_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "OrderRule_shopId_scope_idx" ON "OrderRule"("shopId", "scope");

-- Foreign keys
ALTER TABLE "OrderRule" ADD CONSTRAINT "OrderRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
