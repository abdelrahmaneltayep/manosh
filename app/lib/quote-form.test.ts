import { describe, it, expect } from "vitest";
import {
  normalizeFields,
  moveField,
  emptyField,
  keyFromLabel,
  missingRequired,
} from "./quote-form";
import { quoteFormFeatures as gate } from "./billing";

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

describe("quoteFormFeatures gating (basic universal, advanced Growth)", () => {
  it("basic on every plan; advanced only on Growth", () => {
    expect(gate("STARTER")).toMatchObject({ basicBuilder: true, conditionalLogic: false, multipleForms: false });
    expect(gate(null)).toMatchObject({ basicBuilder: true, multipleForms: false });
    expect(gate("GROWTH")).toMatchObject({ basicBuilder: true, conditionalLogic: true, multipleForms: true, multiLanguage: true });
    expect(gate("Growth")).toMatchObject({ multipleForms: true }); // display-name form too
  });
});
