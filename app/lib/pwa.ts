// F18 — pure PWA logic: the web-app-manifest builder, the service-worker cache
// version/name (bump SW_VERSION to invalidate stale caches), reorder-shortcut
// validation, and the push-payload builder. No Prisma, no network — unit-tested.

// Bump this to ship a new service worker + drop old caches (stale-cache guardrail).
export const SW_VERSION = "1";
export const SW_CACHE_NAME = `mannon-portal-v${SW_VERSION}`;

// Only these portal paths are pre-cached / offline-friendly. Never cache PII
// beyond what a signed-in buyer already sees; the SW is scoped to /portal.
export const SW_SCOPE = "/portal/";
export const SW_PRECACHE = ["/portal", "/portal/manifest.webmanifest"];

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface WebManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
  description?: string;
}

/**
 * Build the web app manifest for a shop's buyer portal, on the brand tokens.
 * `iconUrl` points at the dynamically-generated brand icon route. Pure.
 */
export function buildManifest(shopName: string, iconUrl: string): WebManifest {
  const name = `${shopName} — Wholesale`;
  return {
    name,
    short_name: shopName.slice(0, 12) || "Wholesale",
    start_url: "/portal",
    scope: SW_SCOPE,
    display: "standalone",
    background_color: "#1A1A2E",
    theme_color: "#4F46E5",
    description: "Reorder and request quotes from your wholesale supplier — in one tap.",
    icons: [
      { src: iconUrl, sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: iconUrl, sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
    ],
  };
}

/**
 * The brand app icon as an inline SVG (indigo tile + lime clover "M"). Pure —
 * served by the icon route so no binary asset is checked in.
 */
export function brandIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#1A1A2E"/>
  <path d="M128 372V150l128 118 128-118v222" fill="none" stroke="#4F46E5" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="404" cy="330" r="34" fill="#A3E635"/>
</svg>`;
}

export interface ShortcutLine {
  variantId: string;
  quantity: number;
}

/** Normalize + validate saved reorder-shortcut lines (drop empties, qty ≥ 1). Pure. */
export function normalizeShortcutLines(raw: unknown): ShortcutLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ShortcutLine[] = [];
  for (const r of raw.slice(0, 200)) {
    const row = (r ?? {}) as { variantId?: unknown; quantity?: unknown };
    const variantId = String(row.variantId ?? "").trim();
    const quantity = Math.max(1, Math.trunc(Number(row.quantity) || 0));
    if (variantId) out.push({ variantId, quantity });
  }
  return out;
}

export interface ValidatedShortcut {
  ok: boolean;
  label: string;
  lines: ShortcutLine[];
  error?: string;
}

/** Validate a shortcut before saving. Pure. */
export function validateShortcut(label: unknown, rawLines: unknown): ValidatedShortcut {
  const cleanLabel = String(label ?? "").trim().slice(0, 80) || "Usual order";
  const lines = normalizeShortcutLines(rawLines);
  if (lines.length === 0) return { ok: false, label: cleanLabel, lines, error: "Add at least one item to the shortcut." };
  return { ok: true, label: cleanLabel, lines };
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/** Build the "time to reorder?" push payload. Pure. */
export function reorderPushPayload(shopName: string, shortcutLabel: string | null, portalUrl: string): PushPayload {
  return {
    title: `Time to reorder from ${shopName}?`,
    body: shortcutLabel ? `Your “${shortcutLabel}” is one tap away.` : "Reorder your usual in one tap.",
    url: `${portalUrl.replace(/\/$/, "")}/portal/shortcuts`,
  };
}
