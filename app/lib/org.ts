// F20 — pure, client-safe org helpers (no Prisma / no server imports) so the
// admin route's React component can use them without dragging server code into
// the client bundle.
import type { OrgRole } from "@prisma/client";

/** Who can link/unlink stores and edit branding within an org. Pure. */
export function canManage(role: OrgRole | null | undefined): boolean {
  return role === "OWNER" || role === "MANAGER";
}

/** The store's admin handle (domain without .myshopify.com). Pure. */
export function storeHandle(shopDomain: string): string {
  return shopDomain.replace(/\.myshopify\.com$/i, "");
}

/**
 * Deep link to a store's Shopify admin apps area. The agency member is already a
 * Shopify staff user on the store, so this is org-scoped navigation with no
 * separate Mannon login — Mannon rides the Shopify session. Pure.
 */
export function storeAdminUrl(shopDomain: string): string {
  return `https://admin.shopify.com/store/${storeHandle(shopDomain)}/apps`;
}

/** Display label for a role. Pure. */
export function roleLabel(role: OrgRole): string {
  return role === "OWNER" ? "Owner" : role === "MANAGER" ? "Manager" : "Viewer";
}
