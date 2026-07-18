import type { EventType } from "@prisma/client";

/**
 * AARRR funnel mapping (see /docs/metrics.md). PURE and client-safe — no
 * PostHog, no Prisma runtime, just the mapping from our append-only domain
 * events to product-funnel events. This is the single source of truth for
 * "which event counts as which funnel stage," and it is exhaustively tested.
 *
 * Guardrail #6: all analytics DERIVE from the Event stream. PostHog is a mirror
 * of that stream; the Event table stays the source of truth (the F5 dashboard
 * reads the table directly, never PostHog).
 */

export type AarrrStage =
  | "acquisition"
  | "activation"
  | "retention"
  | "revenue"
  | "referral";

export interface FunnelEvent {
  /** Product-funnel event name sent to PostHog (snake_case). */
  name: string;
  stage: AarrrStage;
}

/**
 * Domain EventType → funnel event. Types not present here (e.g. QUOTE_EXPIRED)
 * are intentionally NOT funnel events — they still live in the Event table and
 * feed the dashboard, they just don't move a merchant through AARRR.
 *
 * Retention is not a discrete app event — it's derived in PostHog from repeat
 * activation over time (see /docs/metrics.md).
 */
const FUNNEL: Partial<Record<EventType, FunnelEvent>> = {
  APP_INSTALLED: { name: "app_installed", stage: "acquisition" },
  TRIAL_STARTED: { name: "trial_started", stage: "acquisition" },
  QUOTE_SUBMITTED: { name: "quote_submitted", stage: "activation" },
  QUOTE_COUNTERED: { name: "quote_countered", stage: "activation" },
  REORDER_CREATED: { name: "reorder_created", stage: "activation" },
  AI_PARSE_ACCEPTED: { name: "ai_order_accepted", stage: "activation" },
  QUOTE_ACCEPTED: { name: "quote_accepted", stage: "revenue" },
  QUOTE_ORDERED: { name: "quote_ordered", stage: "revenue" },
  DRAFT_ORDER_CREATED: { name: "draft_order_created", stage: "revenue" },
  PLAN_UPGRADED: { name: "plan_upgraded", stage: "revenue" },
  PLAN_CANCELLED: { name: "plan_cancelled", stage: "revenue" },
  REVIEW_PROMPT_SHOWN: { name: "review_prompt_shown", stage: "referral" },
};

/** Map a domain event type to its funnel event, or null if it isn't one. */
export function funnelEventFor(type: EventType): FunnelEvent | null {
  return FUNNEL[type] ?? null;
}

/**
 * Extract scalar properties from an Event payload for PostHog. Only top-level
 * numbers/strings/booleans pass through — nested objects are dropped. Event
 * payloads already carry NO PII (guardrail #6 / data-model.md), so this is a
 * safe passthrough, but keeping it scalar-only avoids leaking anything unexpected.
 */
export function funnelProperties(
  payload: unknown,
): Record<string, number | string | boolean> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}
