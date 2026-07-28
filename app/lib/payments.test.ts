import { describe, it, expect } from "vitest";
import {
  computeDeposit,
  buildSchedule,
  remainingBalance,
  paidToDate,
  installmentStatus,
  planStatus,
  payLinkRedeemable,
  toCents,
  fromCents,
} from "./payments";
import { flexPayAllowed } from "./billing";

const D = (s: string) => new Date(s);

describe("plan gating", () => {
  it("flexible payments are Growth-only", () => {
    expect(flexPayAllowed("GROWTH")).toBe(true);
    expect(flexPayAllowed("Growth")).toBe(true);
    expect(flexPayAllowed("STARTER")).toBe(false);
    expect(flexPayAllowed(null)).toBe(false);
  });
});

describe("money helpers (no floats)", () => {
  it("round-trips cents", () => {
    expect(toCents("293.80")).toBe(29380);
    expect(fromCents(29380)).toBe("293.80");
  });
});

describe("computeDeposit", () => {
  it("splits so deposit + balance === total, exactly", () => {
    const { deposit, balance } = computeDeposit("1000.00", 0.3);
    expect(deposit).toBe("300.00");
    expect(balance).toBe("700.00");
  });
  it("keeps the remainder exact on odd cents", () => {
    const { deposit, balance } = computeDeposit("100.01", 0.3); // 30.003 → 30.00
    expect(deposit).toBe("30.00");
    expect(balance).toBe("70.01");
    expect(toCents(deposit) + toCents(balance)).toBe(toCents("100.01"));
  });
});

describe("buildSchedule", () => {
  it("DEPOSIT: deposit now + one balance installment summing to total", () => {
    const lines = buildSchedule({ type: "DEPOSIT", total: "1000.00", depositPct: 0.3, firstDueDate: D("2026-08-01") });
    expect(lines.map((l) => l.amount)).toEqual(["300.00", "700.00"]);
    expect(lines[0].label).toMatch(/Deposit \(30%\)/);
  });

  it("INSTALLMENTS: deposit + N equal balance parts, remainder on the last, dates spaced", () => {
    const lines = buildSchedule({ type: "INSTALLMENTS", total: "1000.00", depositPct: 0.25, installments: 3, intervalDays: 30, firstDueDate: D("2026-08-01T00:00:00Z") });
    // deposit 250, balance 750 / 3 = 250 each
    expect(lines.map((l) => l.amount)).toEqual(["250.00", "250.00", "250.00", "250.00"]);
    const sum = lines.reduce((s, l) => s + toCents(l.amount), 0);
    expect(sum).toBe(toCents("1000.00"));
    // spacing: 30 days between installment due dates
    expect(lines[2].dueDate.getTime() - lines[1].dueDate.getTime()).toBe(30 * 86400000);
  });

  it("INSTALLMENTS: puts the rounding remainder on the last line", () => {
    const lines = buildSchedule({ type: "INSTALLMENTS", total: "100.00", installments: 3, intervalDays: 30, firstDueDate: D("2026-08-01") });
    // 100 / 3 = 33.33, 33.33, 33.34
    expect(lines.map((l) => l.amount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(lines.reduce((s, l) => s + toCents(l.amount), 0)).toBe(10000);
  });

  it("PAYLINK: a single pay-in-full line", () => {
    const lines = buildSchedule({ type: "PAYLINK", total: "500.00", firstDueDate: D("2026-08-01") });
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe("500.00");
  });
});

describe("balances + statuses", () => {
  const insts = [
    { amount: "300.00", status: "PAID" as const, dueDate: D("2026-08-01"), paidAt: D("2026-08-01") },
    { amount: "700.00", status: "PENDING" as const, dueDate: D("2026-09-01"), paidAt: null },
  ];

  it("remaining + paid split the total", () => {
    expect(paidToDate(insts)).toBe("300.00");
    expect(remainingBalance(insts)).toBe("700.00");
  });

  it("installmentStatus flips to OVERDUE past due", () => {
    expect(installmentStatus({ status: "PENDING", dueDate: D("2026-08-01"), paidAt: null }, D("2026-08-15"))).toBe("OVERDUE");
    expect(installmentStatus({ status: "PENDING", dueDate: D("2026-09-01"), paidAt: null }, D("2026-08-15"))).toBe("PENDING");
    expect(installmentStatus({ status: "PENDING", dueDate: D("2026-08-01"), paidAt: D("2026-08-02") }, D("2026-08-15"))).toBe("PAID");
  });

  it("planStatus: COMPLETED when all paid, OVERDUE if any past due, else ACTIVE", () => {
    const now = D("2026-08-15");
    expect(planStatus([{ status: "PAID", dueDate: D("2026-08-01"), paidAt: D("2026-08-01") }], now)).toBe("COMPLETED");
    expect(planStatus(insts, now)).toBe("ACTIVE"); // balance not yet due
    expect(planStatus([{ status: "PENDING", dueDate: D("2026-08-01"), paidAt: null }], now)).toBe("OVERDUE");
  });
});

describe("payLinkRedeemable", () => {
  const now = D("2026-08-15");
  it("ok while active + unexpired + unused", () => {
    expect(payLinkRedeemable({ status: "ACTIVE", expiresAt: D("2026-08-20"), usedAt: null }, now).ok).toBe(true);
  });
  it("rejects used / expired / inactive", () => {
    expect(payLinkRedeemable({ status: "PAID", expiresAt: D("2026-08-20"), usedAt: D("2026-08-16") }, now)).toEqual({ ok: false, reason: "used" });
    expect(payLinkRedeemable({ status: "ACTIVE", expiresAt: D("2026-08-10"), usedAt: null }, now)).toEqual({ ok: false, reason: "expired" });
    expect(payLinkRedeemable({ status: "EXPIRED", expiresAt: D("2026-08-20"), usedAt: null }, now)).toEqual({ ok: false, reason: "inactive" });
  });
});
