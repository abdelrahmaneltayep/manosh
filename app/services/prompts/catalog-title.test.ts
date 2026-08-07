import { describe, it, expect } from "vitest";
import { catalogTitleFeature } from "./catalog-title";

describe("catalog_title prompt", () => {
  it("includes the internal name and current title", () => {
    const user = catalogTitleFeature.buildUser({ catalogName: "SS26 Retailers", currentTitle: "Spring wholesale" });
    expect(user).toContain("Internal catalog name: SS26 Retailers");
    expect(user).toContain("Current public title: Spring wholesale");
  });
  it("handles an unnamed catalog and no title", () => {
    const user = catalogTitleFeature.buildUser({ catalogName: "", currentTitle: "" });
    expect(user).toContain("Internal catalog name: (unnamed)");
    expect(user).toContain("No public title yet.");
  });
});
