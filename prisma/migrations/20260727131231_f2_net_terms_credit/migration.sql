-- Feature 2: Net Terms + Credit Management.

-- AlterEnum: new activity events
ALTER TYPE "EventType" ADD VALUE 'INVOICE_CREATED';
ALTER TYPE "EventType" ADD VALUE 'REMINDER_SENT';
ALTER TYPE "EventType" ADD VALUE 'CREDIT_OVERRIDE';

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('ACTIVE', 'HOLD');
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'VOID');
CREATE TYPE "ReminderChannel" AS ENUM ('EMAIL');
CREATE TYPE "ReminderKind" AS ENUM ('T_MINUS_3', 'DUE', 'OVERDUE_7');

-- AlterTable: shop-level net-terms defaults + editable templates
ALTER TABLE "Shop" ADD COLUMN "defaultTermsDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Shop" ADD COLUMN "emailTemplates" JSONB;

-- CreateTable
CREATE TABLE "CreditProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "termsDays" INTEGER NOT NULL DEFAULT 30,
    "status" "CreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quoteId" TEXT,
    "orderId" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentReminder" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'EMAIL',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReminder_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "CreditProfile_companyId_key" ON "CreditProfile"("companyId");
CREATE INDEX "Invoice_companyId_status_idx" ON "Invoice"("companyId", "status");
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");
CREATE UNIQUE INDEX "PaymentReminder_invoiceId_kind_key" ON "PaymentReminder"("invoiceId", "kind");
CREATE INDEX "PaymentReminder_invoiceId_idx" ON "PaymentReminder"("invoiceId");

-- Foreign keys
ALTER TABLE "CreditProfile" ADD CONSTRAINT "CreditProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentReminder" ADD CONSTRAINT "PaymentReminder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
