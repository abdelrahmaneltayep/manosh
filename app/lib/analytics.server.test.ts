import { describe, it, expect, vi } from "vitest";
import type { Event } from "@prisma/client";
import {
  captureFunnelEvent,
  type AnalyticsCapture,
  type AnalyticsSink,
} from "./analytics.server";

function fakeSink() {
  const captured: AnalyticsCapture[] = [];
  const sink: AnalyticsSink = { capture: (m) => captured.push(m) };
  return { sink, captured };
}

function event(over: Partial<Event>): Event {
  return {
    id: "e1",
    shopId: "shop_1",
    type: "QUOTE_SUBMITTED",
    entityType: "Quote",
    entityId: "q1",
    payload: null,
    createdAt: new Date(0),
    ...over,
  } as Event;
}

describe("captureFunnelEvent", () => {
  it("captures a mapped event with the shop as distinct id and stage in props", () => {
    const { sink, captured } = fakeSink();
    captureFunnelEvent(
      event({ type: "QUOTE_SUBMITTED", payload: { lineCount: 4 } as never }),
      sink,
    );
    expect(captured).toEqual([
      {
        distinctId: "shop_1",
        event: "quote_submitted",
        properties: {
          aarrr_stage: "activation",
          entity_type: "Quote",
          entity_id: "q1",
          lineCount: 4,
        },
      },
    ]);
  });

  it("does not capture events that aren't funnel steps", () => {
    const { sink, captured } = fakeSink();
    captureFunnelEvent(event({ type: "QUOTE_EXPIRED" }), sink);
    expect(captured).toHaveLength(0);
  });

  it("omits entity_id when the event has none", () => {
    const { sink, captured } = fakeSink();
    captureFunnelEvent(event({ type: "REORDER_CREATED", entityId: null }), sink);
    expect(captured[0].properties).not.toHaveProperty("entity_id");
    expect(captured[0].event).toBe("reorder_created");
  });

  it("is best-effort: a throwing sink never propagates", () => {
    const throwing: AnalyticsSink = {
      capture: vi.fn(() => {
        throw new Error("posthog down");
      }),
    };
    expect(() => captureFunnelEvent(event({ type: "QUOTE_ORDERED" }), throwing)).not.toThrow();
    expect(throwing.capture).toHaveBeenCalledOnce();
  });
});
