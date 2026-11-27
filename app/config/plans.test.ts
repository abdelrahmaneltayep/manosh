import { describe, it, expect } from "vitest";
import {
  claudeAccess,
  trialDaysLeft,
  evaluateQuoteAllowance,
  quoteCapFor,
  CLAUDE_TRIAL_DAYS,
  type ShopClaudeState,
} from "./plans";

const NOW = new Date("2026-08-07T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("claudeAccess", () => {
  it("includes Claude for Growth (aiCounter plan)", () => {
    const a = claudeAccess({ plan: "GROWTH" }, NOW);
    expect(a.state).toBe("included");
    expect(a.allowed).toBe(true);
    expect(a.shouldStartTrial).toBe(false);
    expect(a.daysLeft).toBeNull();
  });

  it("includes Claude for Scale", () => {
    expect(claudeAccess({ plan: "SCALE" }, NOW).state).toBe("included");
  });

  it("includes Claude for a legacy Starter (grandfathered up to Growth caps)", () => {
    const a = claudeAccess({ plan: "STARTER", legacyPlan: true }, NOW);
    expect(a.state).toBe("included");
    expect(a.allowed).toBe(true);
  });

  it("locks Claude for Free from the start", () => {
    const a = claudeAccess({ plan: "FREE" }, NOW);
    expect(a.state).toBe("locked");
    expect(a.allowed).toBe(false);
    expect(a.reason).toBe("plan-locked");
    expect(a.shouldStartTrial).toBe(false);
  });

  it("locks Claude for Starter too: no trial (owner decision, 27 Nov 2026)", () => {
    for (const startedAt of [null, daysAgo(3), daysAgo(1).toISOString()]) {
      const a = claudeAccess({ plan: "STARTER", claudeTrialStartedAt: startedAt }, NOW);
      expect(a.state).toBe("locked");
      expect(a.allowed).toBe(false);
      expect(a.reason).toBe("plan-locked");
      expect(a.shouldStartTrial).toBe(false);
      expect(a.daysLeft).toBeNull();
    }
  });

  it("a shop with no plan selected (TRIAL) is Free-level → Claude locked, no trial started", () => {
    const a = claudeAccess({ plan: "TRIAL", claudeTrialStartedAt: null }, NOW);
    expect(a.state).toBe("locked");
    expect(a.allowed).toBe(false);
    expect(a.shouldStartTrial).toBe(false);
  });

  describe("planGrantsClaude", () => {
    it("is true when included (Growth/Scale)", () => {
      expect(claudeAccess({ plan: "GROWTH" }, NOW).planGrantsClaude).toBe(true);
    });
    it("is false for Free (nothing to toggle)", () => {
      expect(claudeAccess({ plan: "FREE" }, NOW).planGrantsClaude).toBe(false);
    });
    it("is false for Starter", () => {
      expect(claudeAccess({ plan: "STARTER", claudeTrialStartedAt: daysAgo(3) }, NOW).planGrantsClaude).toBe(false);
    });
  });

  describe("merchant on/off toggle (claudeEnabled)", () => {
    it("stays included when the toggle is on or unset", () => {
      expect(claudeAccess({ plan: "GROWTH" }, NOW).state).toBe("included");
      expect(claudeAccess({ plan: "GROWTH", claudeEnabled: true }, NOW).state).toBe("included");
    });

    it("turns an included plan off when toggled off", () => {
      const a = claudeAccess({ plan: "GROWTH", claudeEnabled: false }, NOW);
      expect(a.state).toBe("off");
      expect(a.allowed).toBe(false);
      expect(a.reason).toBe("toggled-off");
      expect(a.planGrantsClaude).toBe(true);
      expect(a.shouldStartTrial).toBe(false);
    });

    it("ignores the toggle for a Free shop (stays locked, not off)", () => {
      const a = claudeAccess({ plan: "FREE", claudeEnabled: false }, NOW);
      expect(a.state).toBe("locked");
      expect(a.reason).toBe("plan-locked");
    });

    it("ignores the toggle for a Starter (stays locked)", () => {
      const a = claudeAccess({ plan: "STARTER", claudeEnabled: false }, NOW);
      expect(a.state).toBe("locked");
      expect(a.reason).toBe("plan-locked");
    });
  });
});

describe("trialDaysLeft", () => {
  it("returns full days for a just-started trial", () => {
    expect(trialDaysLeft(NOW, NOW)).toBe(CLAUDE_TRIAL_DAYS);
  });
  it("ceils partial days", () => {
    const started = new Date(NOW.getTime() - 6.4 * 24 * 60 * 60 * 1000);
    expect(trialDaysLeft(started, NOW)).toBe(1);
  });
  it("never goes negative", () => {
    expect(trialDaysLeft(daysAgo(100), NOW)).toBe(0);
  });
});

describe("evaluateQuoteAllowance", () => {
  it("caps Free at its plan quota", () => {
    const shop: ShopClaudeState = { plan: "FREE" };
    const cap = quoteCapFor(shop);
    expect(Number.isFinite(cap)).toBe(true);
    const under = evaluateQuoteAllowance(shop, cap - 1);
    expect(under.allowed).toBe(true);
    expect(under.capped).toBe(true);
    const at = evaluateQuoteAllowance(shop, cap);
    expect(at.allowed).toBe(false);
  });

  it("is unlimited for every paid tier", () => {
    for (const plan of ["STARTER", "GROWTH", "SCALE"]) {
      const a = evaluateQuoteAllowance({ plan }, 10_000);
      expect(a.allowed).toBe(true);
      expect(a.capped).toBe(false);
      expect(a.cap).toBe(Infinity);
    }
  });
});
