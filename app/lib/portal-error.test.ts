import { describe, it, expect } from "vitest";
import { portalErrorContent } from "./portal-error";

describe("portalErrorContent", () => {
  it("gives a 'not found' message for 404", () => {
    const { title, body } = portalErrorContent(404);
    expect(title).toMatch(/couldn’t find/i);
    expect(body).toMatch(/out of date|no longer available/i);
  });

  it("gives a re-sign-in message for 401 and 403", () => {
    for (const status of [401, 403]) {
      const { title } = portalErrorContent(status);
      expect(title).toMatch(/sign in again/i);
    }
  });

  it("falls back to a generic message for unexpected errors (null status)", () => {
    const { title, body } = portalErrorContent(null);
    expect(title).toBe("Something went wrong");
    expect(body).toMatch(/refresh/i);
  });

  it("uses the generic message for other statuses (e.g. 500)", () => {
    expect(portalErrorContent(500).title).toBe("Something went wrong");
  });

  it("never returns an empty title or body", () => {
    for (const status of [404, 401, 403, 500, null]) {
      const content = portalErrorContent(status);
      expect(content.title.length).toBeGreaterThan(0);
      expect(content.body.length).toBeGreaterThan(0);
    }
  });
});
