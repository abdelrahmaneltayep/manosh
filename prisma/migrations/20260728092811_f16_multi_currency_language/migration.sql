-- Feature 16: Multi-Currency & Multi-Language (GCC-First).

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'LOCALE_CHANGED';

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('SHOPIFY', 'MANUAL');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Shop" ADD COLUMN "supportedLocales" JSONB;
ALTER TABLE "Shop" ADD COLUMN "supportedCurrencies" JSONB;
ALTER TABLE "Shop" ADD COLUMN "i18nStrings" JSONB;
ALTER TABLE "Quote" ADD COLUMN "displayCurrency" TEXT;
ALTER TABLE "Quote" ADD COLUMN "displayRate" DECIMAL(18,8);

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" "RateSource" NOT NULL DEFAULT 'MANUAL',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalePreference" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "memberId" TEXT,
    "locale" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LocalePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListCurrencyOverride" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    CONSTRAINT "PriceListCurrencyOverride_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "CurrencyRate_shopId_base_quote_key" ON "CurrencyRate"("shopId", "base", "quote");
CREATE INDEX "CurrencyRate_shopId_idx" ON "CurrencyRate"("shopId");
CREATE UNIQUE INDEX "LocalePreference_companyId_key" ON "LocalePreference"("companyId");
CREATE UNIQUE INDEX "LocalePreference_memberId_key" ON "LocalePreference"("memberId");
CREATE UNIQUE INDEX "PriceListCurrencyOverride_entryId_currency_key" ON "PriceListCurrencyOverride"("entryId", "currency");
CREATE INDEX "PriceListCurrencyOverride_entryId_idx" ON "PriceListCurrencyOverride"("entryId");

-- Foreign keys
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalePreference" ADD CONSTRAINT "LocalePreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalePreference" ADD CONSTRAINT "LocalePreference_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceListCurrencyOverride" ADD CONSTRAINT "PriceListCurrencyOverride_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "PriceListEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
