import { describe, it, expect } from "vitest";
import {
  normalizeFields,
  moveField,
  emptyField,
  keyFromLabel,
  missingRequired,
  isFieldVisible,
  visibleFields,
  stripAdvanced,
} from "./quote-form";
import { quoteFormFeatures as gate, quoteCaptureAllowed } from "./billing";

describe("quote-form field normalisation", () => {
  it("drops unknown types and coerces flags + strings", () => {
    const out = normalizeFields([
      { type: "text", label: "  Name  ", required: "on", placeholder: " your name " },
      { type: "bogus", label: "nope" },
      { type: "checkbox", label: "Subscribe", required: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "text", label: "Name", required: true, placeholder: "your name" });
    expect(out[1]).toMatchObject({ type: "checkbox", label: "Subscribe", required: false });
  });

  it("guarantees unique, non-empty keys (deduping)", () => {
    const out = normalizeFields([
      { type: "text", label: "Company" },
      { type: "text", label: "Company" },
      { type: "email", label: "" },
    ]);
    expect(out.map((f) => f.key)).toEqual(["company", "company_2", "field"]);
    expect(new Set(out.map((f) => f.key)).size).toBe(out.length);
  });

  it("parses dropdown options from an array or a comma string", () => {
    expect(normalizeFields([{ type: "dropdown", label: "Size", options: ["S", " M ", ""] }])[0].options).toEqual(["S", "M"]);
    expect(normalizeFields([{ type: "dropdown", label: "Size", options: "S, M ,L" }])[0].options).toEqual(["S", "M", "L"]);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeFields(null)).toEqual([]);
    expect(normalizeFields("x")).toEqual([]);
  });
});

describe("moveField reorder", () => {
  const f = (k: string) => ({ ...emptyField("text"), key: k, label: k });
  it("moves an item and clamps out-of-range targets", () => {
    const list = [f("a"), f("b"), f("c")];
    expect(moveField(list, 0, 2).map((x) => x.key)).toEqual(["b", "c", "a"]);
    expect(moveField(list, 2, 0).map((x) => x.key)).toEqual(["c", "a", "b"]);
    expect(moveField(list, 1, 99).map((x) => x.key)).toEqual(["a", "c", "b"]);
    expect(moveField(list, 5, 0)).toHaveLength(3); // no-op on bad from
  });
});

describe("keyFromLabel + missingRequired", () => {
  it("slugs labels", () => {
    expect(keyFromLabel("Company Name!")).toBe("company_name");
    expect(keyFromLabel("   ", "fb")).toBe("fb");
  });
  it("flags only empty required answers", () => {
    const fields = normalizeFields([
      { type: "text", label: "Name", required: true },
      { type: "checkbox", label: "Agree", required: true },
      { type: "text", label: "Note", required: false },
    ]);
    expect(missingRequired(fields, { name: "Jo", agree: "on" })).toEqual([]);
    expect(missingRequired(fields, { name: "  ", agree: false })).toEqual(["Name", "Agree"]);
  });
});

describe("conditional logic (showIf)", () => {
  const built = () =>
    normalizeFields([
      { type: "dropdown", label: "Reason", options: "Bulk,Sample" },
      { type: "text", label: "Bulk qty", showIf: { field: "reason", equals: "Bulk" } },
      { type: "text", label: "Self ref", showIf: { field: "self_ref", equals: "x" } }, // self → dropped
      { type: "text", label: "Bad ref", showIf: { field: "nope", equals: "y" } }, // unknown → dropped
    ]);

  it("keeps only showIf that references an earlier field (drops self/unknown)", () => {
    const f = built();
    expect(f[1].showIf).toEqual({ field: "reason", equals: "Bulk" });
    expect(f[2].showIf).toBeUndefined();
    expect(f[3].showIf).toBeUndefined();
  });

  it("isFieldVisible / visibleFields evaluate the rule", () => {
    const f = built();
    expect(isFieldVisible(f[1], { reason: "Bulk" })).toBe(true);
    expect(isFieldVisible(f[1], { reason: "Sample" })).toBe(false);
    expect(isFieldVisible(f[1], {})).toBe(false); // unanswered → hidden
    expect(visibleFields(f, { reason: "Sample" }).map((x) => x.key)).toEqual(["reason", "self_ref", "bad_ref"]);
    expect(visibleFields(f, { reason: "Bulk" }).map((x) => x.key)).toContain("bulk_qty");
  });

  it("missingRequired skips a hidden required field", () => {
    const f = normalizeFields([
      { type: "dropdown", label: "Reason", options: "Bulk,Sample" },
      { type: "text", label: "Bulk qty", required: true, showIf: { field: "reason", equals: "Bulk" } },
    ]);
    expect(missingRequired(f, { reason: "Sample" })).toEqual([]); // hidden → not demanded
    expect(missingRequired(f, { reason: "Bulk" })).toEqual(["Bulk qty"]); // shown + empty → demanded
  });

  it("stripAdvanced removes showIf (Growth-gate enforcement)", () => {
    const stripped = stripAdvanced(built());
    expect(stripped.every((f) => f.showIf === undefined)).toBe(true);
  });
});

describe("quoteFormFeatures gating (basic universal, advanced Growth)", () => {
  it("basic on every plan; advanced only on Growth", () => {
    expect(gate("STARTER")).toMatchObject({ basicBuilder: true, conditionalLogic: false, multipleForms: false });
    expect(gate(null)).toMatchObject({ basicBuilder: true, multipleForms: false });
    expect(gate("GROWTH")).toMatchObject({ basicBuilder: true, conditionalLogic: true, multipleForms: true, multiLanguage: true });
    expect(gate("Growth")).toMatchObject({ multipleForms: true }); // display-name form too
  });
});

describe("quoteCaptureAllowed (Add-to-Quote / cart→quote — Starter+)", () => {
  it("is true for any paid plan, false otherwise", () => {
    expect(quoteCaptureAllowed("STARTER")).toBe(true);
    expect(quoteCaptureAllowed("GROWTH")).toBe(true);
    expect(quoteCaptureAllowed("Starter")).toBe(true);
    expect(quoteCaptureAllowed("TRIAL")).toBe(false);
    expect(quoteCaptureAllowed(null)).toBe(false);
  });
});
