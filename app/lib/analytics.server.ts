import type { Event } from "@prisma/client";
import { funnelEventFor, funnelProperties } from "./analytics";

/**
 * PostHog sink for the AARRR funnel. The funnel MAPPING is pure (analytics.ts);
 * this module is only the best-effort delivery: it never throws, never blocks a
 * request, and no-ops entirely until `initAnalytics()` has run with a
 * POSTHOG_API_KEY set. The Event table remains the source of truth (guardrail
 * #6) — PostHog is a downstream mirror, so a dropped capture never affects app
 * behaviour or the dashboard.
 */

export interface AnalyticsCapture {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

export interface AnalyticsSink {
  capture(message: AnalyticsCapture): void;
  shutdown?(): Promise<void>;
}

const NOOP_SINK: AnalyticsSink = { capture() {} };

/** Test override — takes precedence over the real sink when set. */
let overrideSink: AnalyticsSink | null = null;
/** Lazily-created real sink (undefined = not yet initialised). */
let realSink: AnalyticsSink | null = null;

function resolveSink(): AnalyticsSink {
  return overrideSink ?? realSink ?? NOOP_SINK;
}

/**
 * Initialise the PostHog client once at server startup. Dynamically imports
 * posthog-node so tests and unconfigured environments never load it. Safe to
 * call more than once; a missing key leaves the sink a no-op.
 */
export async function initAnalytics(): Promise<void> {
  const key = process.env.POSTHOG_API_KEY;
  if (!key || realSink) return;
  const { PostHog } = await import("posthog-node");
  const client = new PostHog(key, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    flushAt: 20,
    flushInterval: 10_000,
  });
  realSink = {
    capture: (message) => client.capture(message),
    shutdown: () => client.shutdown(),
  };
}

/** Flush + close the PostHog client on graceful shutdown. Best-effort. */
export async function shutdownAnalytics(): Promise<void> {
  try {
    await realSink?.shutdown?.();
  } catch {
    // best-effort — never block shutdown on analytics
  }
}

/**
 * Mirror one appended domain event into the AARRR funnel. Best-effort: any
 * failure (mapping, sink, serialisation) is swallowed so analytics can never
 * break the write path. The distinct id is the shop — the merchant/store is the
 * funnel subject. `sink` is injectable for tests.
 */
export function captureFunnelEvent(
  event: Pick<Event, "shopId" | "type" | "entityType" | "entityId" | "payload">,
  sink: AnalyticsSink = resolveSink(),
): void {
  try {
    const funnel = funnelEventFor(event.type);
    if (!funnel) return;
    sink.capture({
      distinctId: event.shopId,
      event: funnel.name,
      properties: {
        aarrr_stage: funnel.stage,
        entity_type: event.entityType,
        ...(event.entityId ? { entity_id: event.entityId } : {}),
        ...funnelProperties(event.payload),
      },
    });
  } catch {
    // best-effort — analytics never throws into the caller
  }
}

// --- test helpers -----------------------------------------------------------

/** Swap in a fake sink for tests. Pass null to clear. */
export function setAnalyticsSinkForTesting(sink: AnalyticsSink | null): void {
  overrideSink = sink;
}
