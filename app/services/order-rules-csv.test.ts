import { describe, it, expect } from "vitest";
import { parseRulesCsv } from "./order-rules.server";

describe("parseRulesCsv", () => {
  it("parses rules and skips the header", () => {
    const { rows, errors } = parseRulesCsv(
      "scope,target_id,min_qty,pack_size,min_order_value,priority\nPRODUCT,gid://v1,,12,,0\nSTORE,,,,250,0",
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ scope: "PRODUCT", targetId: "gid://v1", packSize: 12 });
    expect(rows[1]).toMatchObject({ scope: "STORE", minOrderValue: 250 });
  });

  it("flags an unknown scope", () => {
    const { rows, errors } = parseRulesCsv("BOGUS,,,,,\nSTORE,,,,100,0");
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatch(/unknown scope/);
  });

  it("reports an empty file", () => {
    expect(parseRulesCsv("").errors[0]).toMatch(/empty/);
  });
});
