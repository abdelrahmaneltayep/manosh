import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Guards guardrail #2: the scopes declared in shopify.app.toml must exactly
// match the documented "declared now" set in /docs/compliance.md. S19 does the
// fuller used-vs-declared reconciliation; this catches drift early.
const EXPECTED = [
  "read_companies",
  "read_inventory",
  "read_orders",
  "read_payment_terms",
  "read_products",
  "write_draft_orders",
];

describe("declared OAuth scopes", () => {
  it("shopify.app.toml scopes match the documented minimum set", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const toml = readFileSync(join(repoRoot, "shopify.app.toml"), "utf8");
    const match = toml.match(/scopes\s*=\s*"([^"]*)"/);
    expect(match).not.toBeNull();
    const declared = match![1].split(",").map((s) => s.trim()).filter(Boolean).sort();
    expect(declared).toEqual(EXPECTED);
  });
});
