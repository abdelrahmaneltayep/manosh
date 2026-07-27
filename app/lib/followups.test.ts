import { describe, it, expect } from "vitest";
import {
  clampCadence,
  computeSchedule,
  dueFollowups,
  isBusinessHours,
  hourInZone,
  DEFAULT_POLICY,
  type FollowupPolicy,
} from "./followups";

const submitted = new Date("2026-07-01T00:00:00Z");
const expires = new Date("2026-07-15T00:00:00Z"); // +14 days
const policy: FollowupPolicy = { enabled: true, expiryDays: 14, cadenceDays: [3, 7, 12], maxNudges: 3 };

describe("clampCadence (plan gating)", () => {
  it("Starter (max 1) keeps a single reminder", () => {
    expect(clampCadence([3, 7, 12], 1)).toEqual([3]);
  });
  it("Growth keeps the full cadence, deduped + sorted", () => {
    expect(clampCadence([12, 3, 7, 3], 6)).toEqual([3, 7, 12]);
  });
  it("drops non-positive days", () => {
    expect(clampCadence([0, -1, 5], 6)).toEqual([5]);
  });
});

describe("computeSchedule", () => {
  it("schedules reminders on cadence, a warning the day before, and the expiry", () => {
    const items = computeSchedule(submitted, expires, policy, 6);
    const kinds = items.map((i) => i.kind);
    expect(kinds.filter((k) => k === "REMINDER")).toHaveLength(3);
    expect(kinds).toContain("EXPIRY_WARNING");
    expect(kinds[kinds.length - 1]).toBe("EXPIRED");
    // day-3 reminder
    expect(items[0].scheduledFor.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    // warning = expiry - 1 day
    const warn = items.find((i) => i.kind === "EXPIRY_WARNING")!;
    expect(warn.scheduledFor.toISOString()).toBe("2026-07-14T00:00:00.000Z");
  });

  it("Starter cadence is a single reminder", () => {
    const items = computeSchedule(submitted, expires, policy, 1);
    expect(items.filter((i) => i.kind === "REMINDER")).toHaveLength(1);
  });

  it("never schedules a reminder at/after expiry", () => {
    const items = computeSchedule(submitted, new Date("2026-07-05T00:00:00Z"), policy, 6);
    // only day-3 fits before a +4-day expiry
    expect(items.filter((i) => i.kind === "REMINDER")).toHaveLength(1);
  });

  it("respects maxNudges below the cadence length", () => {
    const items = computeSchedule(submitted, expires, { ...policy, maxNudges: 2 }, 6);
    expect(items.filter((i) => i.kind === "REMINDER")).toHaveLength(2);
  });

  it("returns nothing when the policy is disabled", () => {
    expect(computeSchedule(submitted, expires, { ...policy, enabled: false }, 6)).toEqual([]);
  });
});

describe("dueFollowups", () => {
  const now = new Date("2026-07-08T10:00:00Z");
  const rows = [
    { id: "a", kind: "REMINDER" as const, status: "SCHEDULED" as const, scheduledFor: "2026-07-04T00:00:00Z" },
    { id: "b", kind: "REMINDER" as const, status: "SCHEDULED" as const, scheduledFor: "2026-07-20T00:00:00Z" },
    { id: "c", kind: "EXPIRED" as const, status: "SCHEDULED" as const, scheduledFor: "2026-07-07T00:00:00Z" },
    { id: "d", kind: "REMINDER" as const, status: "SENT" as const, scheduledFor: "2026-07-04T00:00:00Z" },
  ];

  it("returns past-due scheduled rows within business hours", () => {
    const due = dueFollowups(rows, { now, unsubscribed: false, businessHoursOk: true }).map((f) => f.id);
    expect(due).toContain("a");
    expect(due).toContain("c");
    expect(due).not.toContain("b"); // future
    expect(due).not.toContain("d"); // already sent
  });

  it("skips reminders when unsubscribed, but still runs EXPIRED", () => {
    const due = dueFollowups(rows, { now, unsubscribed: true, businessHoursOk: true }).map((f) => f.id);
    expect(due).toEqual(["c"]);
  });

  it("holds reminders outside business hours, but not EXPIRED", () => {
    const due = dueFollowups(rows, { now, unsubscribed: false, businessHoursOk: false }).map((f) => f.id);
    expect(due).toEqual(["c"]);
  });
});

describe("isBusinessHours", () => {
  it("is true on a weekday mid-morning UTC", () => {
    // 2026-07-08 is a Wednesday
    expect(isBusinessHours(new Date("2026-07-08T10:00:00Z"), "UTC")).toBe(true);
  });
  it("is false at night", () => {
    expect(isBusinessHours(new Date("2026-07-08T03:00:00Z"), "UTC")).toBe(false);
  });
  it("is false on the weekend", () => {
    // 2026-07-11 is a Saturday
    expect(isBusinessHours(new Date("2026-07-11T10:00:00Z"), "UTC")).toBe(false);
  });
  it("shifts with the timezone", () => {
    // 22:00 UTC is 01:00 next day in Riyadh (+3) → outside hours
    expect(hourInZone(new Date("2026-07-08T22:00:00Z"), "Asia/Riyadh")).toBe(1);
  });
});

describe("DEFAULT_POLICY", () => {
  it("expires in 14 days with a 3/7/12 cadence", () => {
    expect(DEFAULT_POLICY.expiryDays).toBe(14);
    expect(DEFAULT_POLICY.cadenceDays).toEqual([3, 7, 12]);
  });
});
