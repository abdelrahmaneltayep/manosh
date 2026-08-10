import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * AI-13 Buyer summary — a one-paragraph relationship briefing a merchant can read
 * before a call or email. Dual-mode: pre-fills a read-only panel the merchant
 * reviews; Claude writes nothing to the account. Summarises only the facts given.
 */

export interface BuyerSummaryInput {
  companyName: string;
  buyerName: string;
  totalOrders: number;
  totalQuotes: number;
  openQuotes: number;
  lastOrderDaysAgo: number | null;
  termsDays: number | null;
  lifetimeValue: string | null;
  currency: string | null;
}

export const BUYER_SUMMARY_TOOL: AnthropicSDK.Tool = {
  name: "draft_buyer_summary",
  description: "Return a concise relationship briefing for a wholesale buyer.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "3-5 sentences: who they are as an account, their ordering/quoting pattern, anything open, and a neutral read on the relationship. Plain business English. Invent nothing beyond the facts given.",
      },
    },
    required: ["summary"],
  },
};

export const buyerSummaryFeature = registerFeature<BuyerSummaryInput>({
  key: "buyer_summary",
  system: withSharedRules(
    [
      "Task: write a short internal briefing about a wholesale buyer for the merchant.",
      "Use only the facts provided (order/quote counts, recency, terms, lifetime value). Do not invent history, preferences, or numbers.",
      "Neutral, factual tone — this is a prep note, not marketing copy.",
    ].join("\n"),
  ),
  tool: BUYER_SUMMARY_TOOL,
  buildUser: (input) =>
    [
      `Company: ${input.companyName}`,
      `Primary buyer: ${input.buyerName}`,
      `Total orders: ${input.totalOrders}`,
      `Total quotes: ${input.totalQuotes} (open: ${input.openQuotes})`,
      input.lastOrderDaysAgo == null
        ? "Last order: (no orders yet)"
        : `Last order: ${input.lastOrderDaysAgo} days ago`,
      input.termsDays == null ? "Payment terms: none set" : `Payment terms: net ${input.termsDays}`,
      input.lifetimeValue
        ? `Lifetime value: ${input.lifetimeValue} ${input.currency ?? ""}`.trim()
        : "Lifetime value: (not available)",
    ].join("\n"),
});
