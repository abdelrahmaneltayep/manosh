-- Feature 5: Company Accounts & Multi-Buyer Sub-Accounts.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'MEMBER_INVITED';
ALTER TYPE "EventType" ADD VALUE 'ORDER_APPROVED';

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('ADMIN', 'BUYER', 'APPROVER');
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: Company approval threshold
ALTER TABLE "Company" ADD COLUMN "approvalThreshold" DECIMAL(18,4);

-- AlterTable: Buyer becomes a company member
ALTER TABLE "Buyer" ADD COLUMN "role" "CompanyRole" NOT NULL DEFAULT 'BUYER';
ALTER TABLE "Buyer" ADD COLUMN "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Buyer" ADD COLUMN "invitedAt" TIMESTAMP(3);

-- Backfill: the earliest buyer per company becomes the ADMIN so every existing
-- company has an admin who can invite/manage members.
UPDATE "Buyer" b SET "role" = 'ADMIN'
WHERE b."id" = (
  SELECT b2."id" FROM "Buyer" b2
  WHERE b2."companyId" = b."companyId"
  ORDER BY b2."createdAt" ASC, b2."id" ASC
  LIMIT 1
);

-- CreateTable
CREATE TABLE "OrderApproval" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approverId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "OrderApproval_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "OrderApproval_quoteId_key" ON "OrderApproval"("quoteId");
CREATE INDEX "OrderApproval_companyId_status_idx" ON "OrderApproval"("companyId", "status");
CREATE INDEX "Buyer_companyId_status_idx" ON "Buyer"("companyId", "status");

-- Foreign keys
ALTER TABLE "OrderApproval" ADD CONSTRAINT "OrderApproval_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderApproval" ADD CONSTRAINT "OrderApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderApproval" ADD CONSTRAINT "OrderApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
