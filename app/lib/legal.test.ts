import { describe, it, expect } from "vitest";
import {
  PRIVACY_SECTIONS,
  PRIVACY_LAST_UPDATED,
  SUPPORT_EMAIL,
} from "./legal";

const allText = PRIVACY_SECTIONS.flatMap((s) => [s.heading, ...s.body])
  .join("\n")
  .toLowerCase();

describe("privacy policy content", () => {
  it("has a valid last-updated date and support email", () => {
    expect(PRIVACY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it("every section has a heading and at least one paragraph", () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(0);
    for (const section of PRIVACY_SECTIONS) {
      expect(section.heading.trim().length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
      expect(section.body.every((p) => p.trim().length > 0)).toBe(true);
    }
  });

  it("covers the disclosures Shopify reviewers look for", () => {
    // Data access, storage, deletion/redaction, and contact must all appear.
    expect(allText).toContain("draft order");
    expect(allText).toMatch(/redact|deletion|delete/);
    expect(allText).toMatch(/webhook/);
    expect(allText).toContain(SUPPORT_EMAIL.toLowerCase());
  });

  it("states the two non-negotiable promises: no selling data, no computing money", () => {
    expect(allText).toContain("never sells");
    expect(allText).toContain("never computes money");
  });

  it("discloses the AI order-parsing processor and its confirm-first behaviour", () => {
    expect(allText).toMatch(/anthropic|ai order parsing/);
    expect(allText).toMatch(/confirmation|confirm/);
  });
});
