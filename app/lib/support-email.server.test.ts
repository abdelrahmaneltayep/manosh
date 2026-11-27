import { describe, expect, it } from "vitest";
import { supportEmail } from "./support-email.server";
import { DEFAULT_SUPPORT_EMAIL, PRIVACY_SECTIONS, privacySections } from "./legal";

describe("supportEmail", () => {
  it("defaults to the support-mannon.com address", () => {
    expect(DEFAULT_SUPPORT_EMAIL).toBe("eltayep@support-mannon.com");
    expect(supportEmail({})).toBe(DEFAULT_SUPPORT_EMAIL);
  });

  it("takes MANNON_SUPPORT_EMAIL when it is a valid address", () => {
    expect(supportEmail({ MANNON_SUPPORT_EMAIL: " help@example.com " })).toBe("help@example.com");
    expect(supportEmail({ MANNON_SUPPORT_EMAIL: "not an address" })).toBe(DEFAULT_SUPPORT_EMAIL);
  });

  it("never points at the unregistered mannon.app domain", () => {
    expect(JSON.stringify(PRIVACY_SECTIONS)).not.toContain("mannon.app");
    expect(JSON.stringify(privacySections("help@example.com"))).toContain("help@example.com");
  });
});
