import { describe, it, expect } from "vitest";
import {
  shouldAutoApprove,
  evaluateFormAllowance,
  isHoneypotTripped,
  validateSubmission,
  emailDomain,
  slugifyKey,
  type FieldSpec,
} from "./wholesale";

describe("shouldAutoApprove", () => {
  it("approves when the email domain is allowlisted (case-insensitive)", () => {
    expect(shouldAutoApprove("buyer@Acme.com", ["acme.com"])).toBe(true);
    expect(shouldAutoApprove("buyer@acme.com", ["ACME.COM"])).toBe(true);
  });
  it("does not approve for a non-listed domain", () => {
    expect(shouldAutoApprove("buyer@other.com", ["acme.com"])).toBe(false);
  });
  it("never auto-approves with an empty allowlist (manual review)", () => {
    expect(shouldAutoApprove("buyer@acme.com", [])).toBe(false);
    expect(shouldAutoApprove("buyer@acme.com", null)).toBe(false);
  });
  it("handles malformed email", () => {
    expect(emailDomain("nope")).toBeNull();
    expect(shouldAutoApprove("nope", ["acme.com"])).toBe(false);
  });
});

describe("evaluateFormAllowance (form cap)", () => {
  it("allows the first form on a cap of 1, blocks the second", () => {
    expect(evaluateFormAllowance(0, 1).allowed).toBe(true);
    expect(evaluateFormAllowance(1, 1).allowed).toBe(false);
  });
  it("is unbounded when cap is Infinity", () => {
    expect(evaluateFormAllowance(99, Infinity).allowed).toBe(true);
  });
});

describe("isHoneypotTripped", () => {
  it("trips when the hidden field has content", () => {
    expect(isHoneypotTripped("http://spam")).toBe(true);
    expect(isHoneypotTripped("")).toBe(false);
    expect(isHoneypotTripped(undefined)).toBe(false);
  });
});

describe("validateSubmission", () => {
  const fields: FieldSpec[] = [
    { key: "company", label: "Company", type: "TEXT", required: true },
    { key: "email", label: "Email", type: "EMAIL", required: true },
    { key: "terms", label: "Agree", type: "CHECKBOX", required: true },
    { key: "note", label: "Note", type: "TEXT", required: false },
  ];

  it("passes a complete, valid submission", () => {
    expect(
      validateSubmission(fields, { company: "Acme", email: "a@acme.com", terms: "on" }).ok,
    ).toBe(true);
  });
  it("flags a missing required field", () => {
    const r = validateSubmission(fields, { email: "a@acme.com", terms: "on" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /Company/.test(e))).toBe(true);
  });
  it("flags an invalid email", () => {
    const r = validateSubmission(fields, { company: "Acme", email: "bad", terms: "on" });
    expect(r.errors.some((e) => /valid email/.test(e))).toBe(true);
  });
  it("requires a checked required checkbox", () => {
    const r = validateSubmission(fields, { company: "Acme", email: "a@acme.com" });
    expect(r.errors.some((e) => /Agree/.test(e))).toBe(true);
  });
});

describe("slugifyKey", () => {
  it("makes a stable machine key", () => {
    expect(slugifyKey("Resale Certificate #")).toBe("resale_certificate");
    expect(slugifyKey("")).toBe("field");
  });
});
