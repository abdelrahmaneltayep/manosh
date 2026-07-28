-- Feature 19: Catalog Sharing & B2B Discovery (Faire-style).

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'PUBLIC_CATALOG_PUBLISHED';
ALTER TYPE "EventType" ADD VALUE 'CATALOG_LEAD_CREATED';

-- CreateEnum
CREATE TYPE "PublicCatalogVisibility" AS ENUM ('LINK', 'LISTED');
CREATE TYPE "PublicCatalogPrices" AS ENUM ('HIDDEN', 'AFTER_APPROVAL', 'PUBLIC');
CREATE TYPE "PublicCatalogStatus" AS ENUM ('DRAFT', 'LIVE');
CREATE TYPE "CatalogLeadStatus" AS ENUM ('NEW', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "PublicCatalog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" "PublicCatalogVisibility" NOT NULL DEFAULT 'LINK',
    "showPrices" "PublicCatalogPrices" NOT NULL DEFAULT 'HIDDEN',
    "status" "PublicCatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogLead" (
    "id" TEXT NOT NULL,
    "publicCatalogId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyName" TEXT,
    "message" TEXT,
    "status" "CatalogLeadStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogLead_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "PublicCatalog_shopId_slug_key" ON "PublicCatalog"("shopId", "slug");
CREATE INDEX "PublicCatalog_shopId_idx" ON "PublicCatalog"("shopId");
CREATE INDEX "PublicCatalog_visibility_status_idx" ON "PublicCatalog"("visibility", "status");
CREATE INDEX "CatalogLead_publicCatalogId_status_idx" ON "CatalogLead"("publicCatalogId", "status");

-- Foreign keys
ALTER TABLE "PublicCatalog" ADD CONSTRAINT "PublicCatalog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicCatalog" ADD CONSTRAINT "PublicCatalog_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogLead" ADD CONSTRAINT "CatalogLead_publicCatalogId_fkey" FOREIGN KEY ("publicCatalogId") REFERENCES "PublicCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
