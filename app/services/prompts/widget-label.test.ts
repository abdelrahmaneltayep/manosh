import { describe, it, expect } from "vitest";
import { widgetLabelFeature } from "./widget-label";

describe("widget_label prompt", () => {
  it("includes the purpose and current label", () => {
    const user = widgetLabelFeature.buildUser({
      context: "Make an Offer button on product and cart pages",
      currentLabel: "Make an offer",
    });
    expect(user).toContain("Button purpose: Make an Offer button on product and cart pages");
    expect(user).toContain("Current label: Make an offer");
  });
  it("handles an empty current label", () => {
    const user = widgetLabelFeature.buildUser({ context: "Request a quote button", currentLabel: "" });
    expect(user).toContain("No current label.");
  });
});
