import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * S19 self-review gauntlet — static guardrail checks that lock in the
 * non-negotiables from CLAUDE.md so they can't silently regress. Behavioural
 * coverage lives in the colocated service/route tests; these are the
 * cross-cutting invariants a single slice's tests wouldn't catch.
 */

const appDir = dirname(fileURLToPath(import.meta.url)); // app/
const repoRoot = dirname(appDir);
const routesDir = join(appDir, "routes");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("Guardrail #3 — every webhook is HMAC-verified and rejects with 401", () => {
  const webhookRoutes = readdirSync(routesDir).filter(
    (f) => f.startsWith("webhooks.") && f.endsWith(".tsx") && !f.includes(".test."),
  );

  it("finds the webhook routes", () => {
    expect(webhookRoutes.length).toBeGreaterThanOrEqual(5);
  });

  it.each(webhookRoutes)("%s verifies HMAC and returns 401", (file) => {
    const src = readFileSync(join(routesDir, file), "utf8");
    expect(src).toMatch(/verifyWebhook/);
    expect(src).toMatch(/401/);
  });
});

describe("Guardrail #4 — the AI order parser is deterministic", () => {
  it("calls the model at temperature 0", () => {
    const src = readFileSync(join(appDir, "services/ai/order-parser.server.ts"), "utf8");
    expect(src).toMatch(/temperature:\s*0\b/);
    // Forced tool use — the model must answer via the tool, not free text.
    expect(src).toMatch(/tool_choice/);
  });
});

describe("Undercover model identity — never committed to source", () => {
  it("no claude-opus model identifier appears in app/, docs/, or prisma/", () => {
    const dirs = ["app", "docs", "prisma"].map((d) => join(repoRoot, d)).filter(existsSync);
    const forbidden = /claude-opus-4-\d/;
    const offenders = dirs
      .flatMap((d) => sourceFiles(d).concat(extraDocs(d)))
      .filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

// Also scan markdown docs, not just .ts/.tsx.
function extraDocs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...extraDocs(full));
    else if (/\.(md|prisma|toml)$/.test(entry)) out.push(full);
  }
  return out;
}
