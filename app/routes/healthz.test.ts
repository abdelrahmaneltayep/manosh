import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loader } from "./healthz";

const REQUIRED = {
  SHOPIFY_API_KEY: "ad4c04f1bcb8aab2dc441ea8bf947a00",
  SHOPIFY_API_SECRET: "shpss_realsecret",
  SHOPIFY_APP_URL: "https://manosh.fly.dev",
  SCOPES: "read_products",
  SESSION_SECRET: "x".repeat(40),
  DATABASE_URL: "postgres://u:p@h/db",
};

describe("GET /healthz", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of Object.keys(REQUIRED)) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("returns 200 + configOk when core config is present", async () => {
    Object.assign(process.env, REQUIRED);
    const res = loader();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", live: true, configOk: true, requiredIssues: 0 });
  });

  it("returns 503 (degraded) when a required var is missing", async () => {
    Object.assign(process.env, REQUIRED);
    delete process.env.SHOPIFY_API_SECRET;
    const res = loader();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.configOk).toBe(false);
    expect(body.requiredIssues).toBeGreaterThan(0);
  });

  it("responds without a database or Shopify session (pure liveness read)", () => {
    expect(loader()).toBeInstanceOf(Response);
  });

  it("never leaks secret values or variable names in the public body", async () => {
    Object.assign(process.env, REQUIRED);
    const text = await loader().text();
    expect(text).not.toContain("shpss_realsecret");
    expect(text).not.toContain("ad4c04f1bcb8aab2dc441ea8bf947a00");
    expect(text).not.toContain("SHOPIFY_API_SECRET");
  });
});
