-- Feature 10: Accounting Sync (QuickBooks Online & Xero).

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'ACCOUNTING_CONNECTED';
ALTER TYPE "EventType" ADD VALUE 'INVOICE_SYNCED';

-- CreateEnum
CREATE TYPE "AccountingProvider" AS ENUM ('QBO', 'XERO');
CREATE TYPE "AccountingConnStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'ERROR');
CREATE TYPE "SyncEntity" AS ENUM ('INVOICE', 'PAYMENT', 'CUSTOMER');
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');
CREATE TYPE "CustomerMatchStrategy" AS ENUM ('EMAIL', 'NAME');

-- CreateTable
CREATE TABLE "AccountingConnection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "provider" "AccountingProvider" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "realmId" TEXT,
    "tenantId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "AccountingConnStatus" NOT NULL DEFAULT 'CONNECTED',
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSyncLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "provider" "AccountingProvider" NOT NULL,
    "entity" "SyncEntity" NOT NULL,
    "localId" TEXT NOT NULL,
    "remoteId" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "digested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingMap" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "taxCodeMap" JSONB NOT NULL DEFAULT '{}',
    "accountMap" JSONB NOT NULL DEFAULT '{}',
    "customerMatchStrategy" "CustomerMatchStrategy" NOT NULL DEFAULT 'EMAIL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingMap_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "AccountingConnection_shopId_provider_key" ON "AccountingConnection"("shopId", "provider");
CREATE UNIQUE INDEX "AccountingSyncLog_shopId_provider_entity_localId_key" ON "AccountingSyncLog"("shopId", "provider", "entity", "localId");
CREATE INDEX "AccountingSyncLog_shopId_status_idx" ON "AccountingSyncLog"("shopId", "status");
CREATE UNIQUE INDEX "AccountingMap_shopId_key" ON "AccountingMap"("shopId");

-- Foreign keys
ALTER TABLE "AccountingConnection" ADD CONSTRAINT "AccountingConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingSyncLog" ADD CONSTRAINT "AccountingSyncLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingMap" ADD CONSTRAINT "AccountingMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
