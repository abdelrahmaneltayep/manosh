import { describe, it, expect } from "vitest";
import { quoteRequestReplyFeature } from "./quote-request-reply";

describe("quote_request_reply prompt", () => {
  it("carries the company, item count, and note", () => {
    const user = quoteRequestReplyFeature.buildUser({
      companyName: "ACME Ltd",
      itemCount: 3,
      note: "Need pricing for 500 units",
    });
    expect(user).toContain("Company: ACME Ltd");
    expect(user).toContain("Items requested: 3");
    expect(user).toContain("Their note: Need pricing for 500 units");
  });
  it("handles a missing company and note", () => {
    const user = quoteRequestReplyFeature.buildUser({ companyName: null, itemCount: 1, note: null });
    expect(user).toContain("Company: (not provided)");
    expect(user).toContain("No note left.");
  });
});
