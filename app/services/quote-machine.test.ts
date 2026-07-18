import { describe, it, expect } from "vitest";
import type { QuoteStatus } from "@prisma/client";
import {
  IllegalQuoteTransitionError,
  assertTransition,
  canTransition,
  isExpired,
  isTerminal,
} from "./quote.server";

const ALL: QuoteStatus[] = [
  "SUBMITTED",
  "COUNTERED",
  "ACCEPTED",
  "ORDERED",
  "EXPIRED",
];

// The complete set of legal transitions, encoded independently of the service
// so the test is a real cross-check, not a mirror of the implementation.
const LEGAL = new Set([
  "SUBMITTED>COUNTERED",
  "SUBMITTED>EXPIRED",
  "COUNTERED>ACCEPTED",
  "COUNTERED>EXPIRED",
  "ACCEPTED>ORDERED",
  "ACCEPTED>EXPIRED",
]);

describe("quote transition guards (pure, no DB)", () => {
  it("canTransition matches the table for all 25 (from,to) pairs", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(LEGAL.has(`${from}>${to}`));
      }
    }
  });

  it("ORDERED and EXPIRED are terminal; others are not", () => {
    expect(isTerminal("ORDERED")).toBe(true);
    expect(isTerminal("EXPIRED")).toBe(true);
    expect(isTerminal("SUBMITTED")).toBe(false);
    expect(isTerminal("COUNTERED")).toBe(false);
    expect(isTerminal("ACCEPTED")).toBe(false);
  });

  it("terminal states cannot be reopened to anything", () => {
    for (const from of ["ORDERED", "EXPIRED"] as QuoteStatus[]) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("a SUBMITTED quote cannot be accepted directly (must be countered first)", () => {
    expect(canTransition("SUBMITTED", "ACCEPTED")).toBe(false);
    expect(canTransition("SUBMITTED", "ORDERED")).toBe(false);
  });

  it("assertTransition throws IllegalQuoteTransitionError carrying from/to", () => {
    expect(() => assertTransition("SUBMITTED", "ACCEPTED")).toThrow(
      IllegalQuoteTransitionError,
    );
    try {
      assertTransition("ACCEPTED", "COUNTERED");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalQuoteTransitionError);
      const typed = error as IllegalQuoteTransitionError;
      expect(typed.from).toBe("ACCEPTED");
      expect(typed.to).toBe("COUNTERED");
    }
  });

  it("assertTransition allows every legal transition", () => {
    for (const key of LEGAL) {
      const [from, to] = key.split(">") as [QuoteStatus, QuoteStatus];
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it("isExpired is true only for a non-terminal quote past its expiry", () => {
    const past = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-02-01T00:00:00Z");
    const future = new Date("2026-03-01T00:00:00Z");

    expect(isExpired({ status: "SUBMITTED", expiresAt: past }, now)).toBe(true);
    expect(isExpired({ status: "ACCEPTED", expiresAt: past }, now)).toBe(true);
    expect(isExpired({ status: "SUBMITTED", expiresAt: future }, now)).toBe(
      false,
    );
    // Terminal states are never "expired" even if the timestamp has passed.
    expect(isExpired({ status: "ORDERED", expiresAt: past }, now)).toBe(false);
    expect(isExpired({ status: "EXPIRED", expiresAt: past }, now)).toBe(false);
  });
});
