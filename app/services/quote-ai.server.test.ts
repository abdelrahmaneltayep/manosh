import { describe, it, expect } from "vitest";
import { rateLimitOk, AI_RATE_LIMIT_MS } from "./quote-ai.server";

describe("rateLimitOk", () => {
  it("allows the first call (no prior timestamp)", () => {
    expect(rateLimitOk(undefined, 1000)).toBe(true);
  });

  it("blocks a call inside the window", () => {
    expect(rateLimitOk(1000, 1000 + AI_RATE_LIMIT_MS - 1)).toBe(false);
  });

  it("allows a call once the window has passed", () => {
    expect(rateLimitOk(1000, 1000 + AI_RATE_LIMIT_MS)).toBe(true);
  });
});

// The DB-backed generate/persist path (generateSuggestionForLine) is covered by
// integration tests when a Postgres DATABASE_URL is present; it self-skips here
// (mirrors plan-limits.server.test.ts). The pure floor/margin guardrail — the
// security-critical part — is fully covered in ai/quote-assistant.server.test.ts.
