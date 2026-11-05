import { describe, it, expect, afterEach } from "vitest";
import { DISCOVERY_ENABLED, allowedVisibility, listDiscovery } from "./public-catalog.server";

const saved = { share: process.env.MANNON_FF_CATALOG_SHARE, disc: process.env.MANNON_FF_DISCOVERY };
afterEach(() => {
  process.env.MANNON_FF_CATALOG_SHARE = saved.share;
  if (saved.disc === undefined) delete process.env.MANNON_FF_DISCOVERY;
  else process.env.MANNON_FF_DISCOVERY = saved.disc;
});

describe("discovery directory switch (off for the App Store review, 1.1.6)", () => {
  it("is off unless MANNON_FF_DISCOVERY=true, even with catalog sharing on", () => {
    process.env.MANNON_FF_CATALOG_SHARE = "true";
    delete process.env.MANNON_FF_DISCOVERY;
    expect(DISCOVERY_ENABLED()).toBe(false);
    process.env.MANNON_FF_DISCOVERY = "true";
    expect(DISCOVERY_ENABLED()).toBe(true);
  });

  it("while off, a 'Listed' catalog is saved as link-only and the directory is empty", async () => {
    process.env.MANNON_FF_CATALOG_SHARE = "true";
    delete process.env.MANNON_FF_DISCOVERY;
    expect(allowedVisibility("LISTED")).toBe("LINK");
    expect(allowedVisibility("LINK")).toBe("LINK");
    expect(allowedVisibility(undefined)).toBeUndefined();
    expect(await listDiscovery()).toEqual([]);
  });

  it("while on, 'Listed' is kept", () => {
    process.env.MANNON_FF_CATALOG_SHARE = "true";
    process.env.MANNON_FF_DISCOVERY = "true";
    expect(allowedVisibility("LISTED")).toBe("LISTED");
  });
});
