-- Feature 24 PR-8e: post-submission control (message | redirect) + per-locale
-- form translations. Generalises PR-8b's successMessage into successMode +
-- successValue and adds a translations JSON. (No live data yet — safe to drop.)

-- CreateEnum
CREATE TYPE "QuoteFormSuccessMode" AS ENUM ('MESSAGE', 'REDIRECT');

-- AlterTable
ALTER TABLE "QuoteForm" DROP COLUMN "successMessage";
ALTER TABLE "QuoteForm" ADD COLUMN "successMode" "QuoteFormSuccessMode" NOT NULL DEFAULT 'MESSAGE';
ALTER TABLE "QuoteForm" ADD COLUMN "successValue" TEXT;
ALTER TABLE "QuoteForm" ADD COLUMN "translations" JSONB;
