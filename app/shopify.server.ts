import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureShopInstalled } from "./services/shop.server";

/**
 * Boot-time config guard. The embedded admin needs these at runtime — without
 * SHOPIFY_API_KEY/SECRET the App Bridge iframe can't initialize (the merchant /
 * App-Store reviewer sees "Something went wrong. Please refresh"), even though
 * /healthz still returns 200. We log the *names* of any missing/placeholder vars
 * (never values) so `fly logs` reveals a misconfig instantly instead of it
 * surfacing as an opaque error page. Non-fatal so healthz stays up and the fix
 * is obvious. Runs once at module load in production.
 */
function warnMissingShopifyEnv(): void {
  if (process.env.NODE_ENV !== "production") return;
  const required = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES", "SESSION_SECRET", "DATABASE_URL"];
  const missing = required.filter((k) => !process.env[k]);
  // Catch the classic paste-the-placeholder mistake, too.
  const placeholder = Object.entries({
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
  })
    .filter(([, v]) => v && /^<.*>$|from Partners|changeme|placeholder/i.test(v))
    .map(([k]) => k);
  if (missing.length || placeholder.length) {
    console.error(
      "[mannon] CONFIG ERROR — embedded admin will fail with 'Something went wrong'. " +
        (missing.length ? `Missing env: ${missing.join(", ")}. ` : "") +
        (placeholder.length ? `Placeholder value still set for: ${placeholder.join(", ")}. ` : "") +
        "Set them with `fly secrets set …` (SHOPIFY_API_KEY must equal the app client_id).",
    );
  }
}
warnMissingShopifyEnv();

// Confirm the current stable ApiVersion via the Shopify Dev MCP at the start of
// each build session before pinning — see CLAUDE.md tech stack notes.
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // Shopify App Pricing (managed pricing): plans live in the Partner Dashboard,
  // so the app defines NO billing config and never creates charges. This flag
  // lets billing.check read the merchant's active subscription without one.
  hooks: {
    // Provision the Shop row on install (and record APP_INSTALLED — the top of
    // the acquisition funnel). Idempotent, so re-auth/scope changes no-op.
    afterAuth: async ({ session }) => {
      await ensureShopInstalled(session.shop);
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
