// F13 — pure, server-authoritative payment math. No Prisma, no network, no
// floats: all money is computed in integer minor units (cents) and formatted
// back to 2-dp strings, so a deposit + installments ALWAYS sum to the exact
// order total. Unit-tested. Mannon never stores card data — this only computes
// what Shopify-hosted checkout should capture.

export type PlanType = "DEPOSIT" | "INSTALLMENTS" | "PAYLINK";
export type InstallmentStatus = "PENDING" | "PAID" | "OVERDUE";
export type PlanStatus = "ACTIVE" | "COMPLETED" | "OVERDUE";

/** Parse a money string/number to integer cents. Throws on garbage. */
export function toCents(amount: string | number): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${amount}`);
  return Math.round(n * 100);
}

/** Format integer cents back to a 2-dp string. */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Clamp a deposit fraction to a sane 0<pct<1 (a deposit can't be 0 or the whole order). */
export function normalizeDepositPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(Math.max(pct, 0), 1);
}

export interface DepositSplit {
  deposit: string; // amount due now
  balance: string; // remaining
}

/**
 * Split a total into a deposit + balance by fraction. Rounds the deposit to the
 * cent; the balance is the exact remainder so deposit + balance === total. Pure.
 */
export function computeDeposit(total: string | number, depositPct: number): DepositSplit {
  const totalC = toCents(total);
  const pct = normalizeDepositPct(depositPct);
  const depositC = Math.round(totalC * pct);
  return { deposit: fromCents(depositC), balance: fromCents(totalC - depositC) };
}

export interface ScheduleInput {
  type: PlanType;
  total: string | number;
  depositPct?: number; // for DEPOSIT and INSTALLMENTS(with deposit)
  installments?: number; // number of balance installments (INSTALLMENTS)
  intervalDays?: number; // spacing between installments
  firstDueDate: Date; // when the first balance installment is due
}

export interface ScheduleLine {
  sortOrder: number;
  label: string;
  amount: string;
  dueDate: Date;
}

/**
 * Build the full schedule (deposit installment #0 due now, then the balance
 * split into N equal installments with the rounding remainder on the LAST line).
 * The amounts always sum to the total. Pure — dates come from firstDueDate +
 * intervalDays so the function stays deterministic (no Date.now()).
 */
export function buildSchedule(input: ScheduleInput): ScheduleLine[] {
  const totalC = toCents(input.total);
  const now = input.firstDueDate; // deposit "due now" pinned to the same clock the caller passes
  const lines: ScheduleLine[] = [];

  if (input.type === "PAYLINK") {
    // A single pay-by-link for the whole amount.
    return [{ sortOrder: 0, label: "Pay in full", amount: fromCents(totalC), dueDate: now }];
  }

  let balanceC = totalC;
  const pct = normalizeDepositPct(input.depositPct ?? 0);
  if (pct > 0) {
    const depositC = Math.round(totalC * pct);
    lines.push({ sortOrder: 0, label: `Deposit (${Math.round(pct * 100)}%)`, amount: fromCents(depositC), dueDate: now });
    balanceC = totalC - depositC;
  }

  if (input.type === "DEPOSIT") {
    // Deposit now + a single balance installment.
    lines.push({ sortOrder: lines.length, label: "Balance", amount: fromCents(balanceC), dueDate: input.firstDueDate });
    return lines;
  }

  // INSTALLMENTS: split the balance into N equal parts, remainder on the last.
  const n = Math.max(1, Math.floor(input.installments ?? 1));
  const interval = Math.max(1, Math.floor(input.intervalDays ?? 30));
  const per = Math.floor(balanceC / n);
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const amtC = isLast ? balanceC - allocated : per;
    allocated += amtC;
    const dueDate = new Date(input.firstDueDate.getTime() + i * interval * 24 * 60 * 60 * 1000);
    lines.push({ sortOrder: lines.length, label: `Installment ${i + 1} of ${n}`, amount: fromCents(amtC), dueDate });
  }
  return lines;
}

/** The remaining unpaid balance across installments. Pure. */
export function remainingBalance(installments: Array<{ amount: string; status: InstallmentStatus }>): string {
  const c = installments.reduce((sum, i) => (i.status === "PAID" ? sum : sum + toCents(i.amount)), 0);
  return fromCents(c);
}

/** The amount paid so far. Pure. */
export function paidToDate(installments: Array<{ amount: string; status: InstallmentStatus }>): string {
  const c = installments.reduce((sum, i) => (i.status === "PAID" ? sum + toCents(i.amount) : sum), 0);
  return fromCents(c);
}

/** Derive an installment's live status from its stored status + due date. Pure. */
export function installmentStatus(
  inst: { status: InstallmentStatus; dueDate: Date; paidAt: Date | null },
  now: Date = new Date(),
): InstallmentStatus {
  if (inst.status === "PAID" || inst.paidAt) return "PAID";
  return inst.dueDate.getTime() < now.getTime() ? "OVERDUE" : "PENDING";
}

/** Derive a plan's status from its installments. Pure. */
export function planStatus(
  installments: Array<{ status: InstallmentStatus; dueDate: Date; paidAt: Date | null }>,
  now: Date = new Date(),
): PlanStatus {
  const live = installments.map((i) => installmentStatus(i, now));
  if (live.every((s) => s === "PAID")) return "COMPLETED";
  if (live.some((s) => s === "OVERDUE")) return "OVERDUE";
  return "ACTIVE";
}

/** Is a pay-link redeemable right now? Pure. */
export function payLinkRedeemable(
  link: { status: string; expiresAt: Date; usedAt: Date | null },
  now: Date = new Date(),
): { ok: boolean; reason?: "used" | "expired" | "inactive" } {
  if (link.usedAt || link.status === "PAID") return { ok: false, reason: "used" };
  if (link.status !== "ACTIVE") return { ok: false, reason: "inactive" };
  if (link.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}
