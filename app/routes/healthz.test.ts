import { describe, it, expect } from "vitest";
import { loader } from "./healthz";

describe("GET /healthz", () => {
  it("returns 200 with body 'ok'", async () => {
    const response = await loader();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("responds without a database or Shopify session", () => {
    // The loader takes no args and touches no external services, so a probe
    // never fails just because the DB or Shopify is momentarily unreachable.
    expect(loader()).toBeInstanceOf(Response);
  });
});
