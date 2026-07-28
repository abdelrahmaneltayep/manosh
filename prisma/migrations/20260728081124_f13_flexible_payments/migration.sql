-- Feature 13: Flexible Payments — Deposits, Partial Pay & Pay-by-Link.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'PAYMENT_PLAN_CREATED';
ALTER TYPE "EventType" ADD VALUE 'INSTALLMENT_PAID';
ALTER TYPE "EventType" ADD VALUE 'PAYLINK_PAID';

-- CreateEnum
CREATE TYPE "PaymentPlanType" AS ENUM ('DEPOSIT', 'INSTALLMENTS', 'PAYLINK');
CREATE TYPE "PaymentPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'OVERDUE');
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE');
CREATE TYPE "PayLinkStatus" AS ENUM ('ACTIVE', 'PAID', 'EXPIRED');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "defaultDepositPct" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "type" "PaymentPlanType" NOT NULL,
    "depositPct" DECIMAL(5,4),
    "schedule" JSONB,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentInstallment" (
    "id" TEXT NOT NULL,
    "paymentPlanId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "reminderStages" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayLink" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "installmentId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayLink_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "PaymentPlan_quoteId_key" ON "PaymentPlan"("quoteId");
CREATE INDEX "PaymentInstallment_paymentPlanId_idx" ON "PaymentInstallment"("paymentPlanId");
CREATE INDEX "PaymentInstallment_status_dueDate_idx" ON "PaymentInstallment"("status", "dueDate");
CREATE UNIQUE INDEX "PayLink_tokenHash_key" ON "PayLink"("tokenHash");
CREATE INDEX "PayLink_quoteId_idx" ON "PayLink"("quoteId");
CREATE INDEX "PayLink_tokenHash_idx" ON "PayLink"("tokenHash");

-- Foreign keys
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_paymentPlanId_fkey" FOREIGN KEY ("paymentPlanId") REFERENCES "PaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayLink" ADD CONSTRAINT "PayLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayLink" ADD CONSTRAINT "PayLink_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "PaymentInstallment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
