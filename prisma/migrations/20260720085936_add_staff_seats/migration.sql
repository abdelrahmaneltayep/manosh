-- CreateTable
CREATE TABLE "StaffSeat" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffSeat_shopId_idx" ON "StaffSeat"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSeat_shopId_email_key" ON "StaffSeat"("shopId", "email");

-- AddForeignKey
ALTER TABLE "StaffSeat" ADD CONSTRAINT "StaffSeat_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
