-- Feature 15: ERP / Inventory Sync (Real-Time Stock & Order Export).

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'ERP_CONNECTED';
ALTER TYPE "EventType" ADD VALUE 'STOCK_SYNCED';
ALTER TYPE "EventType" ADD VALUE 'ORDER_EXPORTED';

-- CreateEnum
CREATE TYPE "ErpKind" AS ENUM ('WEBHOOK', 'SFTP', 'NETSUITE', 'CUSTOM');
CREATE TYPE "ErpStatus" AS ENUM ('CONNECTED', 'ERROR');
CREATE TYPE "SyncDirection" AS ENUM ('INBOUND_STOCK', 'OUTBOUND_ORDER');
CREATE TYPE "StockSource" AS ENUM ('SHOPIFY', 'ERP');

-- CreateTable
CREATE TABLE "ErpConnection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" "ErpKind" NOT NULL,
    "endpoint" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretEncrypted" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "sourceOfTruth" "StockSource" NOT NULL DEFAULT 'SHOPIFY',
    "status" "ErpStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSyncLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "entity" TEXT NOT NULL,
    "localId" TEXT,
    "remoteId" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "digested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOverride" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "source" "StockSource" NOT NULL,
    "qty" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StockOverride_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "ErpConnection_shopId_key" ON "ErpConnection"("shopId");
CREATE INDEX "ErpSyncLog_shopId_status_idx" ON "ErpSyncLog"("shopId", "status");
CREATE INDEX "ErpSyncLog_shopId_direction_idx" ON "ErpSyncLog"("shopId", "direction");
CREATE UNIQUE INDEX "StockOverride_shopId_variantId_key" ON "StockOverride"("shopId", "variantId");
CREATE INDEX "StockOverride_shopId_idx" ON "StockOverride"("shopId");

-- Foreign keys
ALTER TABLE "ErpConnection" ADD CONSTRAINT "ErpConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErpSyncLog" ADD CONSTRAINT "ErpSyncLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockOverride" ADD CONSTRAINT "StockOverride_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
