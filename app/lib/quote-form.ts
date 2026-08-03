// F24.1 — Storefront quote form schema (pure, client-safe). The merchant builds
// an ordered list of fields; the theme app extension renders them and the buyer's
// answers ride along on the QuoteRequest. No PII logic here — just the field
// shape, validation/normalisation, and reorder helpers. Unit-tested.

export type QuoteFieldType =
  | "text"
  | "number"
  | "email"
  | "phone"
  | "dropdown"
  | "checkbox"
  | "file"
  | "date"
  | "product";

/** Conditional-logic rule (F24 PR-8b, Growth): show this field only when the
 *  answer to `field` (an earlier field's key) equals `equals`. */
export interface ShowIfRule {
  field: string;
  equals: string;
}

export interface QuoteFormField {
  /** Stable machine key (unique within a form), used as the answer key. */
  key: string;
  type: QuoteFieldType;
  label: string;
  required: boolean;
  placeholder?: string;
  help?: string;
  /** Choices for `dropdown` (ignored for other types). */
  options?: string[];
  /** Growth: show this field only when another field's answer matches. */
  showIf?: ShowIfRule;
}

export type QuoteFormSurface = "PRODUCT" | "COLLECTION" | "CART" | "PAGE";

export const FIELD_TYPES: { value: QuoteFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "file", label: "File upload" },
  { value: "date", label: "Date" },
  { value: "product", label: "Product picker" },
];

export const SURFACES: { value: QuoteFormSurface; label: string }[] = [
  { value: "PRODUCT", label: "Product page" },
  { value: "COLLECTION", label: "Collection page" },
  { value: "CART", label: "Cart" },
  { value: "PAGE", label: "Standalone page" },
];

const VALID_TYPES = new Set<QuoteFieldType>(FIELD_TYPES.map((t) => t.value));

/** A slug-safe key from a label (or a fallback), lowercased, deduped by caller. */
export function keyFromLabel(label: string, fallback = "field"): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || fallback;
}

/** A blank field of a given type, with a sensible default label. Pure. */
export function emptyField(type: QuoteFieldType = "text"): QuoteFormField {
  const label = FIELD_TYPES.find((t) => t.value === type)?.label ?? "Field";
  return { key: "", type, label, required: false };
}

/**
 * Validate + normalise a raw fields array (e.g. from the DB Json column or a
 * form submission). Drops entries with an unknown type, coerces flags, trims
 * strings, and guarantees **unique non-empty keys** (deriving/deduping from the
 * label when missing). Pure — safe on the client and the server.
 */
export function normalizeFields(raw: unknown): QuoteFormField[] {
  if (!Array.isArray(raw)) return [];
  const out: QuoteFormField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>;
    const type = r.type as QuoteFieldType;
    if (!VALID_TYPES.has(type)) continue;
    const label = typeof r.label === "string" && r.label.trim() ? r.label.trim() : "Field";

    let key = typeof r.key === "string" && r.key.trim() ? keyFromLabel(r.key) : keyFromLabel(label, `field_${i + 1}`);
    if (!key) key = `field_${i + 1}`;
    // Guarantee uniqueness.
    let unique = key;
    let n = 2;
    while (seen.has(unique)) unique = `${key}_${n++}`;
    seen.add(unique);

    const field: QuoteFormField = {
      key: unique,
      type,
      label,
      required: r.required === true || r.required === "true" || r.required === "on",
    };
    if (typeof r.placeholder === "string" && r.placeholder.trim()) field.placeholder = r.placeholder.trim();
    if (typeof r.help === "string" && r.help.trim()) field.help = r.help.trim();
    if (type === "dropdown") {
      const opts = Array.isArray(r.options)
        ? r.options.map((o) => String(o).trim()).filter(Boolean)
        : typeof r.options === "string"
          ? r.options.split(",").map((o) => o.trim()).filter(Boolean)
          : [];
      if (opts.length) field.options = opts;
    }
    // Conditional logic (Growth): reference an EARLIER field's key only (no
    // cycles, no self-reference). Invalid references are dropped, not errored.
    const rawShowIf = r.showIf as { field?: unknown; equals?: unknown } | undefined;
    if (rawShowIf && typeof rawShowIf.field === "string") {
      const ref = keyFromLabel(rawShowIf.field);
      if (ref && ref !== unique && seen.has(ref)) {
        field.showIf = { field: ref, equals: rawShowIf.equals == null ? "" : String(rawShowIf.equals) };
      }
    }
    out.push(field);
  }
  return out;
}

/**
 * Is a field currently visible given the buyer's answers? A field with no
 * `showIf` is always visible; otherwise the referenced field's answer must equal
 * the rule value (checkbox truthiness is normalised to "true"/"false"). Pure.
 */
export function isFieldVisible(field: QuoteFormField, answers: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const raw = answers[field.showIf.field];
  const value = raw === true || raw === "true" || raw === "on" ? "true" : raw === false ? "false" : raw == null ? "" : String(raw);
  return value === field.showIf.equals;
}

/** The subset of fields currently visible for these answers. Pure. */
export function visibleFields(fields: QuoteFormField[], answers: Record<string, unknown>): QuoteFormField[] {
  return fields.filter((f) => isFieldVisible(f, answers));
}

/** Strip advanced config (conditional logic) from every field. Used to enforce
 *  the Growth gate server-side so a lower plan can't sneak `showIf` in. Pure. */
export function stripAdvanced(fields: QuoteFormField[]): QuoteFormField[] {
  return fields.map((f) => {
    if (!f.showIf) return f;
    const { showIf: _omit, ...rest } = f;
    return rest;
  });
}

/** Move the field at `from` to `to` (clamped), returning a new array. Pure. */
export function moveField(fields: QuoteFormField[], from: number, to: number): QuoteFormField[] {
  const next = fields.slice();
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Validate a buyer's answers against a form's fields: every required field must
 * have a non-empty value. Returns the missing field labels (empty = valid).
 * Pure — the server calls this before creating the request. File/product fields
 * are treated as present when any truthy value is supplied.
 */
export function missingRequired(fields: QuoteFormField[], answers: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    // A required field hidden by its condition can't be filled — don't demand it.
    if (!isFieldVisible(f, answers)) continue;
    const v = answers[f.key];
    const present = f.type === "checkbox" ? v === true || v === "true" || v === "on" : v != null && String(v).trim() !== "";
    if (!present) missing.push(f.label);
  }
  return missing;
}
