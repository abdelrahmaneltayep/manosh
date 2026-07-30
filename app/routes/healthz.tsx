import { summarizeConfigHealth } from "../lib/config-health";

/**
 * Health probe — liveness + a value-free config-readiness signal.
 *
 * Still dependency-free: it reads only `process.env` (no DB, no Shopify, no
 * network), so it never fails just because an external service is momentarily
 * unreachable. It now also reports whether the app is correctly configured, so an
 * external uptime monitor can alert when required Shopify/runtime vars are missing
 * (which would otherwise surface only as "Something went wrong" inside the embedded
 * admin):
 *   - 200 `{status:"ok", configOk:true}`        — core config present
 *   - 503 `{status:"degraded", configOk:false}` — a required var is missing/placeholder
 *
 * The public body carries NO secret values and NO variable names — only a boolean
 * and a count. The authenticated /app/debug/config route has the per-variable
 * detail. No Fly health check is wired to this route, so a 503 only signals
 * monitors; it does not take the app offline.
 */
export const loader = () => {
  const health = summarizeConfigHealth(process.env);
  const body = {
    status: health.ok ? "ok" : "degraded",
    live: true,
    configOk: health.ok,
    // count only — never names, never values
    requiredIssues: health.requiredMissing.length + health.requiredPlaceholder.length,
  };
  return Response.json(body, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
};
