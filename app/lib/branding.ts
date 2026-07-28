// F20 — pure white-label logic: hex validation, WCAG contrast, readable text
// selection, branding validation, and token resolution. No Prisma, no network —
// unit-tested. The contrast guardrail keeps buyer pages accessible (AA) even
// with a client's colors.

// Mannon brand defaults (the fallback when a shop has no branding).
export const BRAND_DEFAULT_PRIMARY = "#4F46E5"; // indigo
export const BRAND_DEFAULT_ACCENT = "#A3E635"; // lime
export const BRAND_DEFAULT_INK = "#1A1A2E";
export const DEFAULT_PORTAL_NAME = "Wholesale portal";

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** True for a valid #RGB or #RRGGBB hex color. Pure. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

/** Normalize a hex to lowercase #RRGGBB, or null if invalid. Pure. */
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null;
  let hex = (value as string).trim().toLowerCase();
  if (hex.length === 4) {
    hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Relative luminance (WCAG) of a #RRGGBB color in [0,1]. Pure. */
export function relativeLuminance(hex: string): number {
  const norm = normalizeHex(hex) ?? "#000000";
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colors (1..21). Pure. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick #ffffff or the ink color for readable (AA, ≥4.5) text on a background. Pure. */
export function readableTextOn(bg: string): string {
  const onWhite = contrastRatio(bg, "#ffffff");
  const onInk = contrastRatio(bg, BRAND_DEFAULT_INK);
  return onWhite >= onInk ? "#ffffff" : BRAND_DEFAULT_INK;
}

/**
 * Minimum contrast the primary must reach against its auto-chosen text color so
 * button labels stay legible — AA for normal text (4.5:1). Because we pick the
 * better of white/ink, only genuine mid-tones (which read poorly either way)
 * fall below this.
 */
export const MIN_PRIMARY_TEXT_CONTRAST = 4.5;

export interface BrandingInput {
  primaryColor?: unknown;
  accentColor?: unknown;
  portalName?: unknown;
  logoFileId?: unknown;
}

export interface ValidatedBranding {
  ok: boolean;
  error?: string;
  primaryColor: string | null;
  accentColor: string | null;
  portalName: string | null;
  logoFileId: string | null;
}

/**
 * Validate a branding submission. Empty fields clear the override (null). A
 * provided color must be a valid hex AND clear the AA UI-contrast guardrail
 * against white (so button text stays legible). Pure.
 */
export function validateBranding(input: BrandingInput): ValidatedBranding {
  const primary = input.primaryColor === "" || input.primaryColor == null ? null : normalizeHex(input.primaryColor);
  const accent = input.accentColor === "" || input.accentColor == null ? null : normalizeHex(input.accentColor);
  const portalName = String(input.portalName ?? "").trim().slice(0, 40) || null;
  const logoFileId = String(input.logoFileId ?? "").trim() || null;

  if (input.primaryColor && !primary) {
    return { ok: false, error: "Primary color must be a hex value like #4F46E5.", primaryColor: null, accentColor: accent, portalName, logoFileId };
  }
  if (input.accentColor && !accent) {
    return { ok: false, error: "Accent color must be a hex value like #A3E635.", primaryColor: primary, accentColor: null, portalName, logoFileId };
  }
  // Contrast guardrail: the primary is used as a button background with readable
  // text chosen automatically — but reject a primary that can't reach AA on any
  // text (i.e. mid-tones that fail both white and ink).
  if (primary) {
    const best = Math.max(contrastRatio(primary, "#ffffff"), contrastRatio(primary, BRAND_DEFAULT_INK));
    if (best < MIN_PRIMARY_TEXT_CONTRAST) {
      return { ok: false, error: "That primary color is too low-contrast for readable buttons. Pick a deeper or lighter shade.", primaryColor: null, accentColor: accent, portalName, logoFileId };
    }
  }
  return { ok: true, primaryColor: primary, accentColor: accent, portalName, logoFileId };
}

export interface BrandingTokens {
  primary: string;
  primaryText: string;
  accent: string;
  portalName: string;
  logoFileId: string | null;
  /** True when any override is active (drives whether we inject CSS vars). */
  custom: boolean;
}

/**
 * Resolve the effective buyer-facing tokens for a shop, layering a Branding
 * record over the Mannon defaults. Text color on the primary is chosen for AA
 * contrast automatically. Pure.
 */
export function resolveBrandingTokens(
  branding: { primaryColor?: string | null; accentColor?: string | null; portalName?: string | null; logoFileId?: string | null } | null,
): BrandingTokens {
  const primary = normalizeHex(branding?.primaryColor) ?? BRAND_DEFAULT_PRIMARY;
  const accent = normalizeHex(branding?.accentColor) ?? BRAND_DEFAULT_ACCENT;
  const portalName = (branding?.portalName ?? "").trim() || DEFAULT_PORTAL_NAME;
  const logoFileId = branding?.logoFileId ?? null;
  const custom = Boolean(
    normalizeHex(branding?.primaryColor) ||
      normalizeHex(branding?.accentColor) ||
      (branding?.portalName ?? "").trim() ||
      branding?.logoFileId,
  );
  return { primary, primaryText: readableTextOn(primary), accent, portalName, logoFileId, custom };
}
