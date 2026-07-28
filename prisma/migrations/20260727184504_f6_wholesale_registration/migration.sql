-- Feature 6: Wholesale Registration + Gated Approval.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'WHOLESALE_APPLICATION_DECIDED';

-- CreateEnum
CREATE TYPE "WholesaleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MORE_INFO');
CREATE TYPE "WholesaleFieldType" AS ENUM ('TEXT', 'EMAIL', 'SELECT', 'FILE', 'CHECKBOX');

-- CreateTable
CREATE TABLE "WholesaleForm" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveDomains" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WholesaleForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleFormField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "WholesaleFieldType" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WholesaleFormField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WholesaleApplication" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "formId" TEXT,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "phone" TEXT,
    "taxId" TEXT,
    "website" TEXT,
    "answers" JSONB NOT NULL,
    "status" "WholesaleStatus" NOT NULL DEFAULT 'PENDING',
    "tags" TEXT[],
    "companyId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WholesaleApplication_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "WholesaleForm_shopId_idx" ON "WholesaleForm"("shopId");
CREATE UNIQUE INDEX "WholesaleFormField_formId_key_key" ON "WholesaleFormField"("formId", "key");
CREATE INDEX "WholesaleFormField_formId_idx" ON "WholesaleFormField"("formId");
CREATE INDEX "WholesaleApplication_shopId_status_idx" ON "WholesaleApplication"("shopId", "status");
CREATE INDEX "WholesaleApplication_shopId_contactEmail_idx" ON "WholesaleApplication"("shopId", "contactEmail");

-- Foreign keys
ALTER TABLE "WholesaleForm" ADD CONSTRAINT "WholesaleForm_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleFormField" ADD CONSTRAINT "WholesaleFormField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "WholesaleForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleApplication" ADD CONSTRAINT "WholesaleApplication_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleApplication" ADD CONSTRAINT "WholesaleApplication_formId_fkey" FOREIGN KEY ("formId") REFERENCES "WholesaleForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
