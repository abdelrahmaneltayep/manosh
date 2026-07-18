/**
 * Sentry error reporting (server-only). Internal errors go here; user-facing
 * errors stay plain-language Polaris Banners (see CLAUDE.md conventions).
 *
 * No-op until `initSentry()` runs with a SENTRY_DSN set. `captureException`
 * never throws — reporting an error must not itself become an error. Dynamically
 * imports @sentry/node so tests and unconfigured environments never load it.
 */

let sentry: typeof import("@sentry/node") | null = null;

export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || sentry) return;
  const mod = await import("@sentry/node");
  mod.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Product analytics live in PostHog; Sentry is errors only, no perf traces.
    tracesSampleRate: 0,
  });
  sentry = mod;
}

/** Report an internal error. No-op until initSentry() has run. Never throws. */
export function captureException(error: unknown): void {
  try {
    sentry?.captureException(error);
  } catch {
    // reporting must never throw
  }
}
