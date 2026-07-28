// Quick-order pad resolver. The pure parse/resolve now lives in the client-safe
// app/lib/quick-order.ts (so the buyer order pad can parse + price without a
// server round-trip). This module re-exports it so existing server callers and
// tests keep their import paths.
//
// Deterministic SKU + quantity resolution against the catalog is the base that
// AI-1 sits on: the AI proposes SKUs, and they flow through exactly this
// resolver, so an unknown SKU is always flagged inline — never invented.

export type {
  ParsedRow,
  ResolvedLine,
  ResolveResult,
  UnresolvedReason,
  UnresolvedRow,
  CatalogLite,
} from "../lib/quick-order";
export {
  UNRESOLVED_MESSAGE,
  parseSkuQuantityText,
  resolveSkuLines,
} from "../lib/quick-order";
