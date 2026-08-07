import { describe, it, expect } from "vitest";
import { repInviteNoteFeature } from "./rep-invite-note";

describe("rep_invite_note prompt", () => {
  it("includes the rep name and team", () => {
    const user = repInviteNoteFeature.buildUser({ repName: "Jordan", shopName: "acme.myshopify.com" });
    expect(user).toContain("Rep name: Jordan");
    expect(user).toContain("Team / store: acme.myshopify.com");
  });
  it("handles a missing rep name", () => {
    const user = repInviteNoteFeature.buildUser({ repName: "there", shopName: "acme.myshopify.com" });
    expect(user).toContain("Rep name: (not provided)");
  });
});
