-- Feature 11: Custom Catalogs & Per-Customer Product Visibility.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'CATALOG_ASSIGNED';

-- CreateEnum
CREATE TYPE "CatalogVisibility" AS ENUM ('ALL', 'ASSIGNED');

-- CreateTable
CREATE TABLE "Catalog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "CatalogVisibility" NOT NULL DEFAULT 'ASSIGNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogAssignment" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "companyId" TEXT,
    "customerGroupTag" TEXT,
    "memberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogAssignment_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Catalog_shopId_idx" ON "Catalog"("shopId");
CREATE UNIQUE INDEX "CatalogItem_catalogId_productId_variantId_key" ON "CatalogItem"("catalogId", "productId", "variantId");
CREATE INDEX "CatalogItem_catalogId_idx" ON "CatalogItem"("catalogId");
CREATE INDEX "CatalogAssignment_catalogId_idx" ON "CatalogAssignment"("catalogId");
CREATE INDEX "CatalogAssignment_companyId_idx" ON "CatalogAssignment"("companyId");
CREATE INDEX "CatalogAssignment_memberId_idx" ON "CatalogAssignment"("memberId");
CREATE INDEX "CatalogAssignment_customerGroupTag_idx" ON "CatalogAssignment"("customerGroupTag");

-- Foreign keys
ALTER TABLE "Catalog" ADD CONSTRAINT "Catalog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogAssignment" ADD CONSTRAINT "CatalogAssignment_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogAssignment" ADD CONSTRAINT "CatalogAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogAssignment" ADD CONSTRAINT "CatalogAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
