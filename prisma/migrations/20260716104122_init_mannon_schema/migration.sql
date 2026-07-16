-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('TRIAL', 'STARTER', 'GROWTH', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('SUBMITTED', 'COUNTERED', 'ACCEPTED', 'ORDERED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('APP_INSTALLED', 'QUOTE_SUBMITTED', 'QUOTE_COUNTERED', 'QUOTE_ACCEPTED', 'QUOTE_ORDERED', 'QUOTE_EXPIRED', 'REORDER_CREATED', 'DRAFT_ORDER_CREATED', 'AI_PARSE_ACCEPTED', 'TRIAL_STARTED', 'PLAN_UPGRADED', 'PLAN_CANCELLED', 'REVIEW_PROMPT_SHOWN');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "autoApproveTolerance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quoteExpiryDays" INTEGER NOT NULL DEFAULT 14,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "shopifyContactId" TEXT,
    "magicTokenHash" TEXT,
    "magicTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "poReference" TEXT,
    "draftOrderId" TEXT,
    "totalsSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "total" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReorderSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "Company_shopId_idx" ON "Company"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_shopId_shopifyCompanyId_key" ON "Company"("shopId", "shopifyCompanyId");

-- CreateIndex
CREATE INDEX "Buyer_magicTokenHash_idx" ON "Buyer"("magicTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_companyId_email_key" ON "Buyer"("companyId", "email");

-- CreateIndex
CREATE INDEX "Quote_companyId_status_idx" ON "Quote"("companyId", "status");

-- CreateIndex
CREATE INDEX "Quote_status_expiresAt_idx" ON "Quote"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- CreateIndex
CREATE INDEX "ReorderSource_companyId_idx" ON "ReorderSource"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderSource_companyId_shopifyOrderId_key" ON "ReorderSource"("companyId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "Event_shopId_type_createdAt_idx" ON "Event"("shopId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderSource" ADD CONSTRAINT "ReorderSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
