import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F21 Make an Offer — Claude drafts a counter to a buyer's offer: a counter
 * TOTAL and a short, friendly negotiation note. The merchant reviews the
 * pre-filled counter form and clicks Send counter themselves (guardrail #4).
 *
 * The floor is enforced in code (app/services/offers-ai.server.ts), never
 * trusted to the model — the prompt states the floor and the server flags any
 * breach and blocks one-click use.
 */

export interface OfferCounterInput {
  currencyCode: string;
  /** Catalog list price total for the offered basket. */
  listPriceTotal: number;
  /** What the buyer offered. */
  offeredTotal: number;
  /** Margin at the offered total (fraction), or null when cost is unknown. */
  marginAtOffer: number | null;
  /** Lowest counter total that still clears the merchant's floor margin; null if unknown. */
  floorTotal: number | null;
  /** The merchant's floor margin, fraction (0.15 = 15%). */
  minMarginPct: number;
}

export const OFFER_COUNTER_TOOL: AnthropicSDK.Tool = {
  name: "draft_offer_counter",
  description:
    "Return a suggested counter total and a short, friendly note to the buyer proposing it.",
  input_schema: {
    type: "object",
    properties: {
      counter_total: {
        type: "number",
        description:
          "Suggested counter TOTAL for the whole basket. Must never be below the floor total stated in the prompt, and never above the list price.",
      },
      note: {
        type: "string",
        description:
          "A short, friendly note to the buyer proposing the counter. No prices invented beyond the counter total.",
      },
    },
    required: ["counter_total", "note"],
  },
};

export const offerCounterFeature = registerFeature<OfferCounterInput>({
  key: "offer_counter",
  system: withSharedRules(
    [
      "Task: propose a counter to a buyer's offer on a wholesale basket.",
      "You get the list price, the buyer's offer, the current margin, and a floor total.",
      "Aim between the buyer's offer and list price, protecting margin; reward a reasonable",
      "offer with a small concession. Never counter below the floor total or above list price.",
    ].join("\n"),
  ),
  tool: OFFER_COUNTER_TOOL,
  buildUser: (input) => {
    const pct = Math.round(input.minMarginPct * 100);
    return [
      `Currency: ${input.currencyCode}`,
      `List price total: ${input.listPriceTotal.toFixed(2)}`,
      `Buyer offered: ${input.offeredTotal.toFixed(2)}`,
      input.marginAtOffer == null
        ? "Margin at offer: unknown (no cost on file — be conservative)"
        : `Margin at offer: ${Math.round(input.marginAtOffer * 100)}%`,
      input.floorTotal == null
        ? `Floor total: unknown (cost missing) — stay at or above the buyer's offer, target the list price`
        : `Floor total (never go below): ${input.floorTotal.toFixed(2)}`,
      `Merchant floor margin: ${pct}%`,
    ].join("\n");
  },
});
