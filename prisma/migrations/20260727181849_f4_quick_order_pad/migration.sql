-- Feature 4: Enhanced Quick Order / Bulk Order Pad.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'ORDERPAD_USED';

-- CreateTable
CREATE TABLE "SavedOrderList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedOrderList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedOrderItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    CONSTRAINT "SavedOrderItem_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "SavedOrderList_companyId_idx" ON "SavedOrderList"("companyId");
CREATE UNIQUE INDEX "SavedOrderItem_listId_variantId_key" ON "SavedOrderItem"("listId", "variantId");
CREATE INDEX "SavedOrderItem_listId_idx" ON "SavedOrderItem"("listId");

-- Foreign keys
ALTER TABLE "SavedOrderList" ADD CONSTRAINT "SavedOrderList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedOrderItem" ADD CONSTRAINT "SavedOrderItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SavedOrderList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
