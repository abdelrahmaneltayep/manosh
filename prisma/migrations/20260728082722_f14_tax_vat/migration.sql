-- Feature 14: Tax Exemption & VAT/GST Handling.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'TAX_PROFILE_VERIFIED';

-- CreateEnum
CREATE TYPE "TaxIdType" AS ENUM ('VAT', 'GST', 'ABN', 'EIN', 'OTHER');
CREATE TYPE "TaxStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "defaultTaxRate" DOUBLE PRECISION;
ALTER TABLE "Shop" ADD COLUMN "invoiceSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "sequenceNo" INTEGER;

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxId" TEXT,
    "taxIdType" "TaxIdType" NOT NULL DEFAULT 'OTHER',
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "certificateName" TEXT,
    "certificateType" TEXT,
    "certificateData" BYTEA,
    "certificateExpiresAt" TIMESTAMP(3),
    "certExpiryRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRuleOverride" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "rate" DECIMAL(6,4),
    "exemptByDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxRuleOverride_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "TaxProfile_companyId_key" ON "TaxProfile"("companyId");
CREATE UNIQUE INDEX "TaxRuleOverride_shopId_region_key" ON "TaxRuleOverride"("shopId", "region");

-- Foreign keys
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxRuleOverride" ADD CONSTRAINT "TaxRuleOverride_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
