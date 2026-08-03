-- Feature 25.2: merchant one-click convert quote → draft order → invoice.

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'QUOTE_CONVERTED';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "convertedOrderId" TEXT;
