import { describe, it, expect } from "vitest";
import { parseCsv, parseImport } from "./quote-import";
import { bulkImportAllowed, bulkImportRowCap } from "./billing";

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes, and CRLF", () => {
    const grid = parseCsv('a,b,c\r\n1,"two, 2","he said ""hi"""\n');
    expect(grid).toEqual([
      ["a", "b", "c"],
      ["1", "two, 2", 'he said "hi"'],
    ]);
  });
});

describe("parseImport — lines mode", () => {
  it("parses valid rows and reports per-row issues", () => {
    const { rows, errors } = parseImport("sku,quantity,price\nMUG,10,9.50\nLID,0,5\n,3,\n", "lines");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ line: 1, sku: "MUG", quantity: 10, price: 9.5 });
    // row 2: quantity 0 invalid; row 3: sku missing.
    expect(errors.map((e) => e.line).sort()).toEqual([2, 3]);
    expect(errors.find((e) => e.line === 2)?.message).toMatch(/Quantity/);
    expect(errors.find((e) => e.line === 3)?.message).toMatch(/SKU/);
  });

  it("flags a missing required column (whole-file error)", () => {
    const { rows, errors } = parseImport("sku,price\nMUG,9\n", "lines");
    expect(rows).toHaveLength(0);
    expect(errors).toEqual([{ line: 0, message: expect.stringContaining("quantity") }]);
  });

  it("treats an empty price as null and drops blank lines", () => {
    const { rows, errors } = parseImport("sku,quantity,price\nMUG,2,\n\n\n", "lines");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].price).toBeNull();
  });
});

describe("parseImport — quotes mode", () => {
  it("requires quote group + a valid email", () => {
    const { rows, errors } = parseImport(
      "quote,email,sku,quantity,price\nA,buyer@acme.com,MUG,5,9\nA,nope,LID,3,\n,x@y.co,PAD,2,\n",
      "quotes",
    );
    expect(rows[0]).toMatchObject({ group: "A", email: "buyer@acme.com", sku: "MUG", quantity: 5, price: 9 });
    // row 2: bad email; row 3: missing group.
    expect(errors.find((e) => e.line === 2)?.message).toMatch(/Email/);
    expect(errors.find((e) => e.line === 3)?.message).toMatch(/group/);
  });
});

describe("bulk import gating", () => {
  it("is Growth-only with a row cap", () => {
    expect(bulkImportAllowed("GROWTH")).toBe(true);
    expect(bulkImportAllowed("STARTER")).toBe(false);
    expect(bulkImportRowCap("GROWTH")).toBe(200);
    expect(bulkImportRowCap("STARTER")).toBe(0);
  });
});
