import type { Event, EventType, Prisma, PrismaClient } from "@prisma/client";
import prisma from "../db.server";

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
  return client.event.create({
    data: {
      shopId: input.shopId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      payload: input.payload ?? undefined,
    },
  });
}
