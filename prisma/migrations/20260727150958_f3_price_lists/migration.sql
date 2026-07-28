-- Feature 3: Customer-Specific Price Lists & Volume Pricing.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'PRICELIST_ASSIGNED';

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceListEntry" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    CONSTRAINT "PriceListEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VolumeBreak" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    CONSTRAINT "VolumeBreak_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyPriceList" (
    "companyId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyPriceList_pkey" PRIMARY KEY ("companyId")
);

CREATE TABLE "PriceListTag" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    CONSTRAINT "PriceListTag_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "PriceList_shopId_idx" ON "PriceList"("shopId");
CREATE UNIQUE INDEX "PriceListEntry_priceListId_variantId_key" ON "PriceListEntry"("priceListId", "variantId");
CREATE INDEX "PriceListEntry_priceListId_idx" ON "PriceListEntry"("priceListId");
CREATE UNIQUE INDEX "VolumeBreak_priceListId_variantId_minQty_key" ON "VolumeBreak"("priceListId", "variantId", "minQty");
CREATE INDEX "VolumeBreak_priceListId_variantId_idx" ON "VolumeBreak"("priceListId", "variantId");
CREATE INDEX "CompanyPriceList_priceListId_idx" ON "CompanyPriceList"("priceListId");
CREATE UNIQUE INDEX "PriceListTag_shopId_tag_key" ON "PriceListTag"("shopId", "tag");
CREATE INDEX "PriceListTag_priceListId_idx" ON "PriceListTag"("priceListId");

-- Foreign keys
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VolumeBreak" ADD CONSTRAINT "VolumeBreak_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPriceList" ADD CONSTRAINT "CompanyPriceList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyPriceList" ADD CONSTRAINT "CompanyPriceList_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceListTag" ADD CONSTRAINT "PriceListTag_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceListTag" ADD CONSTRAINT "PriceListTag_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
