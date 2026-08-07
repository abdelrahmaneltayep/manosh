import { describe, it, expect } from "vitest";
import { taxRejectNoteFeature } from "./tax-reject-note";

describe("tax_reject_note prompt", () => {
  it("carries the company and document state", () => {
    const user = taxRejectNoteFeature.buildUser({
      companyName: "ACME Ltd",
      taxIdType: "VAT",
      hasCertificate: true,
    });
    expect(user).toContain("Company: ACME Ltd");
    expect(user).toContain("Tax ID type on file: VAT");
    expect(user).toContain("certificate was uploaded but could not be verified");
  });
  it("notes when no documents were provided", () => {
    const user = taxRejectNoteFeature.buildUser({ companyName: "ACME", taxIdType: null, hasCertificate: false });
    expect(user).toContain("No tax ID on file.");
    expect(user).toContain("No exemption certificate was uploaded.");
  });
});
