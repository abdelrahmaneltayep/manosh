// F25.3 — bulk CSV import parsing + syntactic validation (pure, client-safe).
// Two modes:
//   · "lines"  — add many products to a single quote. Columns: sku, quantity, price?
//   · "quotes" — create multiple quotes at once. Columns: quote, email, sku, quantity, price?
// Semantic checks (does the SKU resolve? does the buyer exist?) happen in the
// service against the live catalog / DB. This module only parses + validates shape.

export type ImportMode = "lines" | "quotes";

export interface ImportRow {
  /** 1-based data row number (header excluded). */
  line: number;
  group?: string; // "quotes" mode: the grouping key
  email?: string; // "quotes" mode
  sku: string;
  quantity: number;
  price: number | null;
}

export interface RowIssue {
  line: number; // 0 = whole-file (e.g. missing columns)
  message: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  errors: RowIssue[];
}

const REQUIRED: Record<ImportMode, string[]> = {
  lines: ["sku", "quantity"],
  quotes: ["quote", "email", "sku", "quantity"],
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Minimal RFC-4180-ish CSV parser: quoted fields, "" escapes, CRLF/LF. Pure. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row unless the file ended on a newline.
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Parse + syntactically validate a CSV for the given mode. Pure. */
export function parseImport(text: string, mode: ImportMode): ParsedImport {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim() !== "")); // drop blank lines
  const errors: RowIssue[] = [];
  if (grid.length === 0) return { rows: [], errors: [{ line: 0, message: "The file is empty." }] };

  const header = grid[0].map((h) => h.trim().toLowerCase());
  const col: Record<string, number> = {};
  header.forEach((h, i) => { if (!(h in col)) col[h] = i; });
  const missing = REQUIRED[mode].filter((c) => !(c in col));
  if (missing.length) {
    return { rows: [], errors: [{ line: 0, message: `Missing column(s): ${missing.join(", ")}. Expected: ${[...REQUIRED[mode], "price"].join(", ")}.` }] };
  }
  const hasPrice = "price" in col;
  const cell = (r: string[], name: string) => (col[name] != null ? (r[col[name]] ?? "").trim() : "");

  const rows: ImportRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const line = i; // 1-based data row (header is line 0 conceptually)
    const sku = cell(r, "sku");
    const qtyRaw = cell(r, "quantity");
    const priceRaw = hasPrice ? cell(r, "price") : "";
    const qty = Number(qtyRaw);
    const price = priceRaw === "" ? null : Number(priceRaw);

    if (!sku) errors.push({ line, message: "SKU is required." });
    if (!qtyRaw || !Number.isInteger(qty) || qty <= 0) errors.push({ line, message: `Quantity must be a whole number greater than 0 (got "${qtyRaw}").` });
    if (price !== null && (!Number.isFinite(price) || price < 0)) errors.push({ line, message: `Price must be a number ≥ 0 (got "${priceRaw}").` });

    const rowObj: ImportRow = { line, sku, quantity: Number.isFinite(qty) ? qty : 0, price: price !== null && Number.isFinite(price) ? price : null };
    if (mode === "quotes") {
      const group = cell(r, "quote");
      const email = cell(r, "email").toLowerCase();
      if (!group) errors.push({ line, message: "Quote (group) is required." });
      if (!EMAIL_RE.test(email)) errors.push({ line, message: `Email is invalid (got "${cell(r, "email")}").` });
      rowObj.group = group;
      rowObj.email = email;
    }
    rows.push(rowObj);
  }
  return { rows, errors };
}
