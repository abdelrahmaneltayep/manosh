import type { Event, EventType, Prisma, PrismaClient } from "@prisma/client";
import prisma from "../db.server";
import { captureFunnelEvent } from "../lib/analytics.server";

/**
 * Append-only Event log (guardrail #6).
 *
 * This module is the ONLY sanctioned write path for the Event table, and it
 * exposes exactly one mutation — `appendEvent` (an insert). There is
 * deliberately no update, delete, or upsert helper. All insight/analytics
 * (F5 dashboard, F/metrics) derive from reading this stream.
 *
 * Payloads must carry NO PII — ids and numbers only. See /docs/data-model.md
 * and /docs/compliance.md.
 */

export interface AppendEventInput {
  shopId: string;
  type: EventType;
  /** The domain entity this event is about, e.g. "Quote", "Buyer". */
  entityType: string;
  /** Optional id of that entity (Mannon cuid or Shopify GID). */
  entityId?: string | null;
  /** ids + numbers only — never PII. */
  payload?: Prisma.InputJsonValue | null;
}

/**
 * Insert one Event. Accepts an optional client so it can run inside a
 * transaction (`prisma.$transaction`) alongside the state change it records.
 */
export async function appendEvent(
  input: AppendEventInput,
  client: Pick<PrismaClient, "event"> = prisma,
): Promise<Event> {
  const event = await client.event.create({
    data: {
      shopId: input.shopId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      payload: input.payload ?? undefined,
    },
  });
  // Mirror into the AARRR funnel (PostHog). Best-effort and non-blocking — it
  // enqueues only, never throws, and no-ops unless analytics is configured, so
  // it's safe even when this insert runs inside a transaction.
  captureFunnelEvent(event);
  return event;
}
