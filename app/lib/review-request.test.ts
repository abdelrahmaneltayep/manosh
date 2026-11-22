import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requestReview, shouldRecordReviewPrompt } from "./review-request";

describe("shouldRecordReviewPrompt", () => {
  it("records when Shopify showed the modal or the merchant already reviewed", () => {
    expect(shouldRecordReviewPrompt({ success: true, code: "success" })).toBe(true);
    expect(shouldRecordReviewPrompt({ success: false, code: "already-reviewed" })).toBe(true);
  });
  it("keeps the prompt pending on every other decline", () => {
    for (const code of ["cooldown-period", "annual-limit-reached", "recently-installed", "merchant-ineligible", "mobile-app", "cancelled", "already-open", "open-in-progress"]) {
      expect(shouldRecordReviewPrompt({ success: false, code })).toBe(false);
    }
    expect(shouldRecordReviewPrompt(undefined)).toBe(false);
    expect(shouldRecordReviewPrompt(null)).toBe(false);
  });
});

describe("requestReview", () => {
  it("asks App Bridge and reports whether to record", async () => {
    const request = vi.fn().mockResolvedValue({ success: true, code: "success" });
    expect(await requestReview({ reviews: { request } })).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("never throws: a missing API or a rejected request is just 'not shown'", async () => {
    expect(await requestReview(undefined)).toBe(false);
    expect(await requestReview({})).toBe(false);
    expect(await requestReview({ reviews: { request: () => Promise.reject(new Error("boom")) } })).toBe(false);
  });
});

// App Store review 2.1.1: a link from the embedded admin to another site loads
// in the app's frame (the app's Polaris link component is Remix's <Link>, which
// ignores `external`), and sites such as apps.shopify.com refuse to be framed.
// Embedded pages must not carry such links; use App Bridge instead.
describe("embedded admin pages have no links that leave the app frame", () => {
  const root = join(__dirname, "..");
  const files = [
    ...readdirSync(join(root, "routes")).filter((f) => /^app[._].*\.tsx$/.test(f) && !f.includes(".test.")).map((f) => join(root, "routes", f)),
    ...readdirSync(join(root, "components")).filter((f) => f.endsWith(".tsx") && !f.includes(".test.") && f !== "landing.tsx").map((f) => join(root, "components", f)),
  ];
  it("finds the embedded files", () => expect(files.length).toBeGreaterThan(30));
  it.each(files)("%s", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/\bexternal\s*(:\s*true|=\{true\}|(?=[\s/>]))/); // Polaris `external` prop
    expect(src).not.toMatch(/\burl\s*[:=]\s*\{?\s*["'`]https?:\/\//); // url="https://…" or url: "https://…"
    expect(src).not.toMatch(/apps\.shopify\.com/);
  });
});
