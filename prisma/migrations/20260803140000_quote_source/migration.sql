-- Feature 25.4 / 23.4: quote source + duplicate ("create a similar quote").

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'QUOTE_DUPLICATED';

-- CreateEnum
CREATE TYPE "QuoteSource" AS ENUM ('PORTAL', 'WIDGET', 'REP', 'DUPLICATE', 'IMPORT');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "source" "QuoteSource" NOT NULL DEFAULT 'PORTAL';
