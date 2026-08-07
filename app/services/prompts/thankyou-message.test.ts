import { describe, it, expect } from "vitest";
import { thankYouFeature } from "./thankyou-message";

describe("thankyou_message prompt", () => {
  it("includes the form name, surface, and fields", () => {
    const user = thankYouFeature.buildUser({
      formName: "Retailer request",
      surface: "PRODUCT",
      fieldLabels: ["Company", "Quantity"],
    });
    expect(user).toContain("Form name: Retailer request");
    expect(user).toContain("Where it appears: product");
    expect(user).toContain("Fields the buyer filled in: Company, Quantity");
  });
  it("falls back gracefully with no fields or name", () => {
    const user = thankYouFeature.buildUser({ formName: "", surface: "CART", fieldLabels: [] });
    expect(user).toContain("Form name: Quote request");
    expect(user).toContain("default contact fields");
  });
});
