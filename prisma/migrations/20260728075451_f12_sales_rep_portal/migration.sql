-- Feature 12: Sales-Rep Portal (Order-on-Behalf & Assigned Accounts).

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'REP_INVITED';
ALTER TYPE "EventType" ADD VALUE 'ORDER_PLACED_ON_BEHALF';

-- CreateEnum
CREATE TYPE "RepStatus" AS ENUM ('INVITED', 'ACTIVE');

-- CreateTable
CREATE TABLE "SalesRep" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "RepStatus" NOT NULL DEFAULT 'INVITED',
    "magicTokenHash" TEXT,
    "magicTokenExpiresAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesRep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepAssignment" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepAssignment_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "placedByRepId" TEXT;

-- Indexes
CREATE UNIQUE INDEX "SalesRep_shopId_email_key" ON "SalesRep"("shopId", "email");
CREATE INDEX "SalesRep_magicTokenHash_idx" ON "SalesRep"("magicTokenHash");
CREATE UNIQUE INDEX "RepAssignment_repId_companyId_key" ON "RepAssignment"("repId", "companyId");
CREATE INDEX "RepAssignment_companyId_idx" ON "RepAssignment"("companyId");
CREATE INDEX "Quote_placedByRepId_idx" ON "Quote"("placedByRepId");

-- Foreign keys
ALTER TABLE "SalesRep" ADD CONSTRAINT "SalesRep_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepAssignment" ADD CONSTRAINT "RepAssignment_repId_fkey" FOREIGN KEY ("repId") REFERENCES "SalesRep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepAssignment" ADD CONSTRAINT "RepAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_placedByRepId_fkey" FOREIGN KEY ("placedByRepId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
