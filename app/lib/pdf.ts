// Minimal, dependency-free PDF writer (pure, server-side). Enough for a one-page
// branded document: text (Helvetica / Helvetica-Bold, WinAnsi), lines, filled
// rectangles, and RGB colour. No font embedding — the standard-14 Helvetica needs
// none — so it stays tiny and deterministic (great for tests). Text is encoded
// latin1 (WinAnsi ≈ Latin-1), so accented-Latin locales render; non-Latin1 glyphs
// (Arabic, CJK) are dropped since Helvetica can't draw them without an embedded font.
//
// Coordinates are top-left based (y grows downward) — friendlier than PDF's native
// bottom-left — and converted at emit time.

export const A4 = { width: 595.28, height: 841.89 };

type RGB = [number, number, number];

interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  align?: "left" | "right";
  /** Right edge for align:"right". */
  maxX?: number;
}

/** Escape a string for a PDF literal and drop characters Helpetica/WinAnsi can't encode. */
function pdfEscape(s: string): string {
  let out = "";
  for (const ch of String(s)) {
    const code = ch.codePointAt(0)!;
    if (code > 255) continue; // outside Latin-1 / WinAnsi → skip (no glyph)
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code < 32) out += " ";
    else out += ch;
  }
  return out;
}

/** Approximate Helvetica text width in points (avg factor — good enough for right-align). */
export function textWidth(text: string, size: number, bold = false): number {
  return [...String(text)].length * size * (bold ? 0.56 : 0.52);
}

export class PdfBuilder {
  private ops: string[] = [];
  readonly width: number;
  readonly height: number;

  constructor(page: { width: number; height: number } = A4) {
    this.width = page.width;
    this.height = page.height;
  }

  private colorOp(c: RGB, stroke = false): string {
    const [r, g, b] = c.map((v) => Math.max(0, Math.min(1, v)).toFixed(4));
    return `${r} ${g} ${b} ${stroke ? "RG" : "rg"}`;
  }

  text(x: number, yTop: number, str: string, opts: TextOpts = {}): this {
    const size = opts.size ?? 11;
    const font = opts.bold ? "/F2" : "/F1";
    const color = opts.color ?? [0.1, 0.1, 0.18];
    const y = this.height - yTop;
    let tx = x;
    if (opts.align === "right" && opts.maxX != null) tx = opts.maxX - textWidth(str, size, opts.bold);
    this.ops.push(`${this.colorOp(color)}\nBT ${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${pdfEscape(str)}) Tj ET`);
    return this;
  }

  line(x1: number, yTop1: number, x2: number, yTop2: number, opts: { width?: number; color?: RGB } = {}): this {
    const w = opts.width ?? 0.75;
    const color = opts.color ?? [0.85, 0.84, 0.9];
    this.ops.push(`${this.colorOp(color, true)} ${w} w ${x1.toFixed(2)} ${(this.height - yTop1).toFixed(2)} m ${x2.toFixed(2)} ${(this.height - yTop2).toFixed(2)} l S`);
    return this;
  }

  rect(x: number, yTop: number, w: number, h: number, opts: { fill?: RGB } = {}): this {
    const color = opts.fill ?? [0.95, 0.95, 0.98];
    this.ops.push(`${this.colorOp(color)} ${x.toFixed(2)} ${(this.height - yTop - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    return this;
  }

  /** Serialize to PDF bytes. */
  build(): Uint8Array {
    const content = this.ops.join("\n");
    const enc = (s: string) => Buffer.from(s, "latin1");
    const objs: string[] = [
      `<</Type/Catalog/Pages 2 0 R>>`,
      `<</Type/Pages/Kids[3 0 R]/Count 1>>`,
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${this.width.toFixed(2)} ${this.height.toFixed(2)}]/Resources<</Font<</F1 4 0 R/F2 5 0 R>>>>/Contents 6 0 R>>`,
      `<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>`,
      `<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>`,
      `<</Length ${enc(content).length}>>\nstream\n${content}\nendstream`,
    ];

    const parts: Buffer[] = [];
    const offsets: number[] = [];
    let cursor = 0;
    const push = (b: Buffer) => { parts.push(b); cursor += b.length; };

    push(enc(`%PDF-1.4\n%âãÏÓ\n`));
    objs.forEach((body, i) => {
      offsets[i] = cursor;
      push(enc(`${i + 1} 0 obj\n${body}\nendobj\n`));
    });

    const xrefStart = cursor;
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
    push(enc(xref));
    push(enc(`trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`));

    return Buffer.concat(parts);
  }
}
