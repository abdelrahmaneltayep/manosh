import { describe, it, expect } from "vitest";
import { TEMPLATE_GROUPS, TEMPLATE_INFO, mergeTemplateOverride } from "./notification-templates";
import { DEFAULT_TEMPLATES } from "../services/mailer.server";

describe("notification templates", () => {
  it("groups every template exactly once, and every template has a label", () => {
    const grouped = TEMPLATE_GROUPS.flatMap((g) => g.keys);
    const all = Object.keys(DEFAULT_TEMPLATES);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...all].sort());
    for (const k of all) expect(TEMPLATE_INFO[k]?.label).toBeTruthy();
  });

  const D = { subject: "Default subject", body: "Default body" };
  it("stores only the fields that differ from the default and keeps other overrides", () => {
    const next = mergeTemplateOverride({ other: { subject: "Kept" } }, "k", { subject: "Default subject", body: "Mine" }, D);
    expect(next).toEqual({ other: { subject: "Kept" }, k: { body: "Mine" } });
  });
  it("drops the override when the text equals the default, or on reset", () => {
    expect(mergeTemplateOverride({ k: { body: "x" } }, "k", { subject: D.subject, body: D.body }, D)).toEqual({});
    expect(mergeTemplateOverride({ k: { body: "x" }, o: { body: "y" } }, "k", null, D)).toEqual({ o: { body: "y" } });
  });
});
