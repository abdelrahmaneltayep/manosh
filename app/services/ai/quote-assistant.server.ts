import type AnthropicSDK from "@anthropic-ai/sdk";

/**
 * Feature 1 — AI Quote Assistant (Growth-only). Given an open quote line, Claude
 * Haiku proposes a counter-offer: a suggested unit price, a margin/risk read, and
 * a ready-to-send buyer message. This is Mannon's headline differentiator.
 *
 * Guardrails (guardrail #4):
 * - Temperature 0, forced tool call, no autonomous action — the suggestion only
 *   pre-fills the counter field; the merchant always confirms.
 * - The floor price is enforced HERE, in pure code, not trusted to the model: we
 *   compute the floor from cached cost + the merchant's minMarginPct and flag any
 *   model suggestion that breaches it. A breach blocks one-click accept upstream.
 * - No money is settled here — the real total is the draft order (never computed
 *   by us). These prices are proposals only.
 */

export const QUOTE_ASSISTANT_MODEL = "claude-haiku-4-5";

/** Everything the model (and the floor math) needs about one line. */
export interface SuggestionContext {
  /** Line-level suggestion needs a line; quote-level passes the whole basket. */
  productTitle: string;
  sku: string | null;
  requestedQty: number;
  /** The buyer-proposed / current unit price on the quote line. */
  listPrice: number;
  /** Cached wholesale cost, or null when Shopify has none (margin unknown). */
  costPrice: number | null;
  currencyCode: string;
  /** e.g. "Wholesale tier A" — free text from the company/price list. */
  customerTier?: string | null;
  /** Short prior-quote history with this company, most-recent first. */
  quoteHistory?: string[];
  /** Merchant floor margin, fraction (0.15 = 15%). */
  minMarginPct: number;
}

export interface SuggestionModelOutput {
  suggestedPrice: number;
  rationale: string;
  draftMessage: string;
}

export interface QuoteSuggestion extends SuggestionModelOutput {
  /** Lowest unit price that still clears the floor margin; null if cost unknown. */
  floorPrice: number | null;
  /** Margin at the suggested price; null if cost unknown. */
  marginPct: number | null;
  /** True when the model's price would breach the floor (blocks one-click accept). */
  belowFloor: boolean;
  model: string;
}

// --- pure margin / floor math (exhaustively unit-tested) ---------------------

/**
 * Lowest unit price that still clears `minMarginPct`, given unit cost. Derived
 * from margin = (price − cost) / price ≥ m  ⇒  price ≥ cost / (1 − m).
 * Returns null when cost is unknown (we can't compute a floor). Clamps a
 * pathological margin ≥ 1 to null (would divide by zero / go infinite).
 */
export function computeFloorPrice(
  costPrice: number | null,
  minMarginPct: number,
): number | null {
  if (costPrice == null || !Number.isFinite(costPrice) || costPrice < 0) return null;
  if (!Number.isFinite(minMarginPct) || minMarginPct < 0) return null;
  if (minMarginPct >= 1) return null;
  return round4(costPrice / (1 - minMarginPct));
}

/** Margin at a given unit price: (price − cost) / price. Null if cost unknown. */
export function marginForPrice(price: number, costPrice: number | null): number | null {
  if (costPrice == null || !Number.isFinite(costPrice)) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return (price - costPrice) / price;
}

/** Round to 4 dp to match the Decimal(18,4) columns. */
export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Combine the model's raw output with the floor math into the stored suggestion.
 * Pure and deterministic — this is the guardrail boundary, so it's tested hard.
 * We do NOT silently clamp the price up to the floor: we keep the model's number
 * and flag `belowFloor` so the merchant sees the breach and must act explicitly.
 */
export function finalizeSuggestion(
  output: SuggestionModelOutput,
  context: Pick<SuggestionContext, "costPrice" | "minMarginPct">,
  model: string = QUOTE_ASSISTANT_MODEL,
): QuoteSuggestion {
  const suggestedPrice = round4(Math.max(0, output.suggestedPrice));
  const floorPrice = computeFloorPrice(context.costPrice, context.minMarginPct);
  const marginPct = marginForPrice(suggestedPrice, context.costPrice);
  const belowFloor = floorPrice != null && suggestedPrice < floorPrice;
  return {
    suggestedPrice,
    rationale: output.rationale,
    draftMessage: output.draftMessage,
    floorPrice,
    marginPct,
    belowFloor,
    model,
  };
}

// --- model call --------------------------------------------------------------

/** Forced tool the model must call. */
export const SUGGEST_COUNTER_TOOL = {
  name: "suggest_counter_offer",
  description:
    "Return a suggested wholesale unit price, a plain-English rationale, and a ready-to-send buyer message.",
  input_schema: {
    type: "object",
    properties: {
      suggested_unit_price: {
        type: "number",
        description:
          "Suggested wholesale unit price. Must never be below the floor price stated in the prompt.",
      },
      rationale: {
        type: "string",
        description:
          "2-3 plain sentences explaining the price: margin, volume, and history.",
      },
      draft_message: {
        type: "string",
        description:
          "A short, friendly message to the buyer proposing this price. No prices invented beyond the suggestion.",
      },
    },
    required: ["suggested_unit_price", "rationale", "draft_message"],
  },
} satisfies AnthropicSDK.Tool;

/** The cached system prefix: role + policy + the floor. Stable-ish per shop. */
export function buildSuggestionSystemPrompt(minMarginPct: number): string {
  const pct = Math.round(minMarginPct * 100);
  return [
    "You are a wholesale pricing assistant for a B2B merchant on Shopify.",
    "You propose a counter-offer unit price for a quote line, with a short rationale",
    "and a friendly buyer message.",
    "",
    "Rules:",
    `- Never suggest a price that yields less than the merchant's floor margin of ${pct}%.`,
    "- Reward larger quantities and loyal repeat buyers with modest discounts, but protect margin.",
    "- Be concrete and brief. Do not invent SKUs, products, or prices beyond your one suggestion.",
    "- Always respond via the suggest_counter_offer tool.",
  ].join("\n");
}

/** The per-request user content: the specific line + context. */
export function buildSuggestionUserPrompt(context: SuggestionContext): string {
  const floor = computeFloorPrice(context.costPrice, context.minMarginPct);
  const lines = [
    `Product: ${context.productTitle}${context.sku ? ` (SKU ${context.sku})` : ""}`,
    `Requested quantity: ${context.requestedQty}`,
    `Current/list unit price: ${context.currencyCode} ${context.listPrice.toFixed(2)}`,
    context.costPrice != null
      ? `Unit cost: ${context.currencyCode} ${context.costPrice.toFixed(2)}`
      : "Unit cost: unknown (no cost on file — be conservative)",
    floor != null
      ? `Floor price (do not go below): ${context.currencyCode} ${floor.toFixed(2)}`
      : "Floor price: unknown (cost missing) — stay at or above the list price",
    context.customerTier ? `Customer tier: ${context.customerTier}` : null,
    context.quoteHistory && context.quoteHistory.length
      ? `Recent quote history with this company:\n- ${context.quoteHistory.join("\n- ")}`
      : "No prior quote history with this company.",
  ].filter(Boolean);
  return lines.join("\n");
}

/** Coerce arbitrary tool input into a well-formed model output. */
export function normalizeSuggestion(input: unknown): SuggestionModelOutput {
  const obj = (input ?? {}) as Record<string, unknown>;
  const price = Number(obj.suggested_unit_price);
  return {
    suggestedPrice: Number.isFinite(price) ? price : 0,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    draftMessage: typeof obj.draft_message === "string" ? obj.draft_message : "",
  };
}

export type SuggestInvoke = (input: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<SuggestionModelOutput>;

/** Real model call. Forced tool, temperature 0, cached policy prefix. */
export const invokeHaikuSuggestion: SuggestInvoke = async ({
  systemPrompt,
  userPrompt,
}) => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: QUOTE_ASSISTANT_MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ],
    tools: [SUGGEST_COUNTER_TOOL],
    tool_choice: { type: "tool", name: "suggest_counter_offer" },
    messages: [{ role: "user", content: userPrompt }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a suggestion");
  }
  return normalizeSuggestion(toolUse.input);
};

/**
 * Produce a counter-offer suggestion for one line. Calls the model (injectable)
 * then applies the floor math. Pure aside from the injected model call.
 */
export async function suggestCounterOffer(
  context: SuggestionContext,
  options: { invoke?: SuggestInvoke } = {},
): Promise<QuoteSuggestion> {
  const invoke = options.invoke ?? invokeHaikuSuggestion;
  const systemPrompt = buildSuggestionSystemPrompt(context.minMarginPct);
  const userPrompt = buildSuggestionUserPrompt(context);
  const output = await invoke({ systemPrompt, userPrompt });
  return finalizeSuggestion(output, context);
}
