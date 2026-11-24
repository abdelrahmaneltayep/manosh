import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A timestamp late in the UTC evening is already "tomorrow" east of UTC and
// still "today" at UTC. The server renders in UTC, so the formatters must too,
// whatever zone the process or browser is in.
const LATE_EVENING = "2026-11-25T22:30:00.000Z";
const EARLY_MORNING = "2026-11-26T01:30:00.000Z";

describe("formatDate", () => {
  it("prints the UTC day whatever the local time zone is", async () => {
    const original = process.env.TZ;
    try {
      for (const zone of ["UTC", "Asia/Riyadh", "America/Los_Angeles", "Pacific/Auckland"]) {
        // The formatter is built when the module loads, so load it fresh in
        // each zone, the way a browser in that zone would.
        process.env.TZ = zone;
        vi.resetModules();
        const { formatDate } = await import("./format");
        const { formatDate: formatPortalDate } = await import("./i18n");
        expect(formatDate(LATE_EVENING), zone).toBe("Nov 25, 2026");
        expect(formatDate(EARLY_MORNING), zone).toBe("Nov 26, 2026");
        expect(formatPortalDate(new Date(LATE_EVENING)), zone).toBe("Nov 25, 2026");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
      vi.resetModules();
    }
  });
});

// Anything rendered on both the server and in the browser must not depend on
// the viewer's locale or time zone, or hydration fails.
describe("rendered code", () => {
  const roots = ["app/routes", "app/components"];
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) files.push(path);
    }
  };
  roots.forEach(walk);

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("never formats with the viewer's own locale or time zone", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/\.toLocale(?:Date|Time)?String\(\s*(?:undefined|\))/.test(source)) offenders.push(file);
      if (/\.to(?:Date|Time)String\(\)/.test(source)) offenders.push(file);
      if (/new Intl\.(?:DateTimeFormat|NumberFormat)\(\s*(?:undefined|\))/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
