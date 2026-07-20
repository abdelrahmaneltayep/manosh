import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { addStaffSeat, canAddSeat, countSeats } from "./staff-seats.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("staff-seat cap (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","StaffSeat","Buyer","Company","Shop" RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const seedShop = (plan: "STARTER" | "GROWTH") =>
    prisma.shop.create({ data: { shopifyDomain: `${plan}.myshopify.com`, plan } });

  it("Starter allows 1 seat and blocks the 2nd", async () => {
    const shop = await seedShop("STARTER");
    expect(await canAddSeat(shop.id)).toEqual({ allowed: true, used: 0, cap: 1 });

    const first = await addStaffSeat(shop.id, "owner@store.com");
    expect(first.ok).toBe(true);
    expect(await countSeats(shop.id)).toBe(1);

    const second = await addStaffSeat(shop.id, "colleague@store.com");
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.cap).toBe(1);
      expect(second.error).toMatch(/upgrade to growth/i);
    }
    expect(await countSeats(shop.id)).toBe(1);
  });

  it("Growth allows up to 5 seats and blocks the 6th", async () => {
    const shop = await seedShop("GROWTH");
    for (let i = 1; i <= 5; i++) {
      const r = await addStaffSeat(shop.id, `staff${i}@store.com`);
      expect(r.ok).toBe(true);
    }
    expect(await countSeats(shop.id)).toBe(5);

    const sixth = await addStaffSeat(shop.id, "staff6@store.com");
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.cap).toBe(5);
    expect(await countSeats(shop.id)).toBe(5);
  });

  it("re-inviting an existing email is idempotent (not a new seat)", async () => {
    const shop = await seedShop("STARTER");
    await addStaffSeat(shop.id, "owner@store.com");
    const again = await addStaffSeat(shop.id, "OWNER@store.com"); // case-insensitive
    expect(again.ok).toBe(true);
    expect(await countSeats(shop.id)).toBe(1);
  });

  it("rejects an invalid email without consuming a seat", async () => {
    const shop = await seedShop("GROWTH");
    const r = await addStaffSeat(shop.id, "not-an-email");
    expect(r.ok).toBe(false);
    expect(await countSeats(shop.id)).toBe(0);
  });
});
