-- Every outstanding buyer sign-in link (hash only), so a new link never cancels one already sent.
-- CreateTable
CREATE TABLE "BuyerSignInLink" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerSignInLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyerSignInLink_tokenHash_key" ON "BuyerSignInLink"("tokenHash");

-- CreateIndex
CREATE INDEX "BuyerSignInLink_buyerId_idx" ON "BuyerSignInLink"("buyerId");

-- AddForeignKey
ALTER TABLE "BuyerSignInLink" ADD CONSTRAINT "BuyerSignInLink_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

