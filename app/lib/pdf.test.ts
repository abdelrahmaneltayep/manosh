import { describe, it, expect } from "vitest";
import { PdfBuilder, textWidth, A4 } from "./pdf";

function toStr(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

describe("PdfBuilder", () => {
  it("emits a valid single-page PDF with header, xref, and trailer", () => {
    const doc = new PdfBuilder();
    doc.text(40, 60, "Quote #1234", { size: 18, bold: true });
    doc.line(40, 80, 555, 80);
    doc.rect(40, 100, 515, 20);
    const s = toStr(doc.build());
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("xref");
    expect(s).toContain("/Root 1 0 R");
    expect(s).toContain("/BaseFont/Helvetica");
    expect(s).toContain("/Encoding/WinAnsiEncoding");
    expect(s).toContain("(Quote #1234) Tj");
  });

  it("escapes parentheses/backslashes and drops non-Latin1 glyphs", () => {
    const s = toStr(new PdfBuilder().text(0, 0, "A (B) \\ C — café — عربي").build());
    expect(s).toContain("A \\(B\\) \\\\ C"); // escaped
    expect(s).toContain("café"); // é kept (latin1)
    expect(s).not.toContain("عربي"); // Arabic dropped
  });

  it("right-aligns against maxX", () => {
    const doc = new PdfBuilder();
    doc.text(0, 0, "123.00", { align: "right", maxX: 500, size: 10 });
    const s = toStr(doc.build());
    // Td x should be < 500 (pulled left by the text width) and > 400.
    const m = s.match(/([\d.]+) [\d.]+ Td \(123\.00\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(400);
    expect(Number(m![1])).toBeLessThan(500);
  });

  it("textWidth grows with length + bold", () => {
    expect(textWidth("aaaa", 10)).toBeGreaterThan(textWidth("aa", 10));
    expect(textWidth("aa", 10, true)).toBeGreaterThan(textWidth("aa", 10, false));
    expect(A4.width).toBeGreaterThan(500);
  });
});
