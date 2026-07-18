import { describe, it, expect } from "vitest";
import type { EventType } from "@prisma/client";
import { funnelEventFor, funnelProperties, type AarrrStage } from "./analytics";

describe("funnelEventFor (AARRR mapping)", () => {
  it("maps install/trial to acquisition", () => {
    expect(funnelEventFor("APP_INSTALLED")).toEqual({ name: "app_installed", stage: "acquisition" });
    expect(funnelEventFor("TRIAL_STARTED")?.stage).toBe("acquisition");
  });

  it("maps first-value actions to activation", () => {
    const activation: EventType[] = [
      "QUOTE_SUBMITTED",
      "QUOTE_COUNTERED",
      "REORDER_CREATED",
      "AI_PARSE_ACCEPTED",
    ];
    for (const type of activation) {
      expect(funnelEventFor(type)?.stage).toBe("activation");
    }
  });

  it("maps money moments to revenue", () => {
    const revenue: EventType[] = [
      "QUOTE_ACCEPTED",
      "QUOTE_ORDERED",
      "DRAFT_ORDER_CREATED",
      "PLAN_UPGRADED",
      "PLAN_CANCELLED",
    ];
    for (const type of revenue) {
      expect(funnelEventFor(type)?.stage).toBe("revenue");
    }
  });

  it("maps the review prompt to referral", () => {
    expect(funnelEventFor("REVIEW_PROMPT_SHOWN")?.stage).toBe("referral");
  });

  it("returns null for events that are not funnel steps", () => {
    // QUOTE_EXPIRED lives in the Event table + dashboard but is not a funnel move.
    expect(funnelEventFor("QUOTE_EXPIRED")).toBeNull();
  });

  it("every mapped stage is a valid AARRR stage", () => {
    const valid: AarrrStage[] = ["acquisition", "activation", "retention", "revenue", "referral"];
    const all: EventType[] = [
      "APP_INSTALLED", "TRIAL_STARTED", "QUOTE_SUBMITTED", "QUOTE_COUNTERED",
      "REORDER_CREATED", "AI_PARSE_ACCEPTED", "QUOTE_ACCEPTED", "QUOTE_ORDERED",
      "DRAFT_ORDER_CREATED", "PLAN_UPGRADED", "PLAN_CANCELLED", "REVIEW_PROMPT_SHOWN",
    ];
    for (const type of all) {
      const funnel = funnelEventFor(type);
      expect(funnel).not.toBeNull();
      expect(valid).toContain(funnel!.stage);
    }
  });
});

describe("funnelProperties (scalar-only, no PII)", () => {
  it("passes through top-level scalars", () => {
    expect(funnelProperties({ lineCount: 3, needsApproval: false, to: "COUNTERED" })).toEqual({
      lineCount: 3,
      needsApproval: false,
      to: "COUNTERED",
    });
  });

  it("drops nested objects and arrays", () => {
    expect(funnelProperties({ ok: 1, nested: { a: 1 }, list: [1, 2] })).toEqual({ ok: 1 });
  });

  it("returns an empty object for null / non-object payloads", () => {
    expect(funnelProperties(null)).toEqual({});
    expect(funnelProperties(undefined)).toEqual({});
    expect(funnelProperties([1, 2, 3])).toEqual({});
    expect(funnelProperties("nope")).toEqual({});
  });
});
