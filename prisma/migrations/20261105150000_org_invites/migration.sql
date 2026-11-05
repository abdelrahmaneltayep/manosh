-- Agency store linking by consent: a single-use invite code (hashed) that the
-- client store's own merchant redeems inside their Mannon (App Store 2.3.1).
CREATE TABLE "OrgInvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MANAGER',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByShop" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrgInvite_codeHash_key" ON "OrgInvite"("codeHash");
CREATE INDEX "OrgInvite_orgId_idx" ON "OrgInvite"("orgId");

ALTER TABLE "OrgInvite" ADD CONSTRAINT "OrgInvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
