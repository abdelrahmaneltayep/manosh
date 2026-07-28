-- Feature 20: White-Label / Agency Multi-Store Management.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'ORG_CREATED';
ALTER TYPE "EventType" ADD VALUE 'STORE_LINKED';
ALTER TYPE "EventType" ADD VALUE 'BRANDING_UPDATED';

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'MANAGER', 'VIEWER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgStore" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MANAGER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branding" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "logoFileId" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "portalName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Branding_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "OrgStore_shop_key" ON "OrgStore"("shop");
CREATE INDEX "OrgStore_orgId_idx" ON "OrgStore"("orgId");
CREATE UNIQUE INDEX "Branding_shop_key" ON "Branding"("shop");

-- Foreign keys
ALTER TABLE "OrgStore" ADD CONSTRAINT "OrgStore_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
