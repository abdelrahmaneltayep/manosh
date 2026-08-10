import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * AI-12 Win-rate insight — turns the negotiation-analytics numbers into a plain
 * plain-language read plus one concrete suggested action. Dual-mode: the text is
 * advisory and pre-fills a panel the merchant reads; Claude changes no data and
 * takes no action. It reasons only over the metrics passed in.
 */

export interface WinRateInsightInput {
  periodLabel: string;
  winRatePct: number;
  prevWinRatePct: number | null;
  avgDiscountPct: number;
  timeToCloseDays: number;
  quotesWon: number;
  quotesLost: number;
}

export const WIN_RATE_INSIGHT_TOOL: AnthropicSDK.Tool = {
  name: "draft_win_rate_insight",
  description: "Return a short read of the quote win-rate numbers and one suggested action.",
  input_schema: {
    type: "object",
    properties: {
      insight: {
        type: "string",
        description:
          "2-4 sentences interpreting the numbers: the trend vs the previous period, and the most likely driver visible in the data. No invented causes.",
      },
      suggestedAction: {
        type: "string",
        description:
          "One concrete, low-risk next step the merchant could take (e.g. tighten discounting, follow up faster). One sentence.",
      },
    },
    required: ["insight", "suggestedAction"],
  },
};

export const winRateInsightFeature = registerFeature<WinRateInsightInput>({
  key: "win_rate_insight",
  system: withSharedRules(
    [
      "Task: interpret a merchant's quote negotiation metrics for a period and suggest one action.",
      "Compare win rate to the previous period when given; name only drivers that the provided numbers actually support (e.g. high average discount, slow time-to-close).",
      "Do not invent causes, benchmarks, or numbers not in the input. Keep it honest and specific.",
    ].join("\n"),
  ),
  tool: WIN_RATE_INSIGHT_TOOL,
  buildUser: (input) =>
    [
      `Period: ${input.periodLabel}`,
      `Win rate: ${input.winRatePct}%`,
      input.prevWinRatePct == null
        ? "Previous period win rate: (not available)"
        : `Previous period win rate: ${input.prevWinRatePct}%`,
      `Average discount given: ${input.avgDiscountPct}%`,
      `Average time to close: ${input.timeToCloseDays} days`,
      `Quotes won: ${input.quotesWon}`,
      `Quotes lost: ${input.quotesLost}`,
    ].join("\n"),
});
