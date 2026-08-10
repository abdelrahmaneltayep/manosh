import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * AI-11 Reorder prediction — from a buyer's past ordering cadence, Claude reads
 * how "due" a reorder is and drafts a short, low-pressure "time to reorder?"
 * nudge. Dual-mode: the read + message pre-fill a screen the merchant reviews;
 * nothing is sent until they click. The model is given the cadence numbers — it
 * never invents order history.
 */

export interface ReorderPredictionInput {
  companyName: string;
  buyerName: string;
  /** Average days between this buyer's past orders. */
  avgIntervalDays: number;
  /** Days since their most recent order. */
  daysSinceLastOrder: number;
  /** A few items they usually reorder (names only; may be empty). */
  usualItems: string[];
}

export const REORDER_PREDICTION_TOOL: AnthropicSDK.Tool = {
  name: "draft_reorder_nudge",
  description:
    "Return how due the buyer is for a reorder and the body of a short nudge message.",
  input_schema: {
    type: "object",
    properties: {
      likelihood: {
        type: "string",
        enum: ["due", "soon", "not-yet"],
        description:
          "'due' when days-since-last is at or past the average interval; 'soon' when within ~25% of it; otherwise 'not-yet'.",
      },
      message: {
        type: "string",
        description:
          "A warm, low-pressure 2-3 sentence nudge inviting them to reorder. Mention their usual items only if provided. No links or store-name sign-off (added automatically).",
      },
    },
    required: ["likelihood", "message"],
  },
};

export const reorderPredictionFeature = registerFeature<ReorderPredictionInput>({
  key: "reorder_prediction",
  system: withSharedRules(
    [
      "Task: judge how due a wholesale buyer is for a reorder, and draft a short nudge.",
      "Base 'likelihood' only on the cadence numbers given: 'due' if days-since-last ≥ the average interval, 'soon' if within about 25% below it, else 'not-yet'.",
      "The nudge is warm and low-pressure, 2-3 sentences, and references their usual items only if supplied.",
      "Do not invent items, dates, or order counts beyond the input.",
    ].join("\n"),
  ),
  tool: REORDER_PREDICTION_TOOL,
  buildUser: (input) =>
    [
      `Buyer: ${input.buyerName}`,
      `Company: ${input.companyName}`,
      `Average days between orders: ${input.avgIntervalDays}`,
      `Days since last order: ${input.daysSinceLastOrder}`,
      input.usualItems.length
        ? `Usually reorders: ${input.usualItems.join(", ")}`
        : "Usual items: (none provided)",
    ].join("\n"),
});
