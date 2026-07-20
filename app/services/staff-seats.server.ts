import type { StaffSeat } from "@prisma/client";
import prisma from "../db.server";
import { getPlanLimits, seatCapMessage, type SeatAllowance } from "../lib/billing";

/**
 * Staff-seat gating (Starter = 1 seat, Growth = 5). Minimal on purpose — this
 * exists only to enforce the seat cap on the invite action. The pure cap lives
 * in app/lib/billing.ts (PLAN_LIMITS); the counts live here.
 */

export async function listSeats(shopId: string): Promise<StaffSeat[]> {
  return prisma.staffSeat.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
  });
}

export async function countSeats(shopId: string): Promise<number> {
  return prisma.staffSeat.count({ where: { shopId } });
}

/** Whether the shop can add another staff seat under its plan's seat cap. */
export async function canAddSeat(shopId: string): Promise<SeatAllowance> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });
  const { seatCap } = getPlanLimits(shop?.plan ?? null);
  const used = await countSeats(shopId);
  return { allowed: used < seatCap, used, cap: seatCap };
}

export type AddSeatResult =
  | { ok: true; seat: StaffSeat }
  | { ok: false; error: string; used: number; cap: number };

/**
 * Add a staff seat, enforcing the cap first. Blocks the (cap+1)th seat on
 * Starter with an upgrade message. Idempotent on an already-invited email.
 */
export async function addStaffSeat(
  shopId: string,
  email: string,
): Promise<AddSeatResult> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    const allowance = await canAddSeat(shopId);
    return { ok: false, error: "Enter a valid email address.", used: allowance.used, cap: allowance.cap };
  }

  // Re-inviting an existing seat isn't a new seat — allow it idempotently.
  const existing = await prisma.staffSeat.findUnique({
    where: { shopId_email: { shopId, email: normalized } },
  });
  if (existing) return { ok: true, seat: existing };

  const allowance = await canAddSeat(shopId);
  if (!allowance.allowed) {
    return {
      ok: false,
      error: seatCapMessage(allowance.cap),
      used: allowance.used,
      cap: allowance.cap,
    };
  }

  const seat = await prisma.staffSeat.create({
    data: { shopId, email: normalized },
  });
  return { ok: true, seat };
}

export async function removeSeat(shopId: string, seatId: string): Promise<void> {
  await prisma.staffSeat.deleteMany({ where: { id: seatId, shopId } });
}
