import type AnthropicSDK from "@anthropic-ai/sdk";
import type { CatalogItem } from "../catalog.server";

/**
 * AI-1 Magic Order Pad (see /docs/ai-spec.md). Paste a PO/email/spreadsheet →
 * Claude Haiku resolves it to catalog lines → confirm screen → cart.
 *
 * Non-negotiable guardrails (guardrail #4):
 * - Temperature 0, catalog sent as a CACHED system prefix, forced tool call.
 * - Every returned variant_id is validated server-side against the LIVE catalog
 *   and DROPPED if it doesn't exist — the model can never invent a cart line.
 * - The AI never acts autonomously: parsing only produces a proposal; the cart
 *   is built elsewhere, on explicit buyer confirmation.
 */

const MODEL = "claude-haiku-4-5";

export interface ParsedOrderLine {
  variant_id: string;
  sku?: string | null;
  quantity: number;
  raw_text: string;
}
export interface ParsedOrderResult {
  lines: ParsedOrderLine[];
  unmatched: string[];
}

export interface MatchedLine {
  variantId: string;
  sku: string | null;
  title: string;
  quantity: number;
  price: string;
  rawText: string;
}

export interface ValidatedOrder {
  matched: MatchedLine[];
  unmatched: string[];
  /** Fraction of the model's proposed lines that survived catalog validation. */
  acceptedAsIsRate: number;
}

/** The forced tool the model must call. Mirrors /docs/ai-spec.md. */
export const SUBMIT_PARSED_ORDER_TOOL = {
  name: "submit_parsed_order",
  description:
    "Return the parsed order as catalog line items plus anything that could not be matched.",
  input_schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            variant_id: {
              type: "string",
              description:
                "gid://shopify/ProductVariant/... taken ONLY from the provided catalog",
            },
            sku: { type: "string" },
            quantity: { type: "integer", minimum: 1 },
            raw_text: {
              type: "string",
              description: "the source line this was parsed from",
            },
          },
          required: ["variant_id", "quantity", "raw_text"],
        },
      },
      unmatched: {
        type: "array",
        items: { type: "string" },
        description:
          "source lines that could not be confidently matched to a catalog variant",
      },
    },
    required: ["lines", "unmatched"],
  },
} satisfies AnthropicSDK.Tool;

/**
 * The cached system prefix: instructions + the full catalog (SKU, title, variant
 * GID, price). Stable per shop+catalog, so it caches across pastes.
 */
export function buildCatalogSystemPrompt(catalog: CatalogItem[]): string {
  const rows = catalog
    .map(
      (item) =>
        `${item.sku ?? "(no sku)"} | ${item.displayTitle} | ${item.variantId} | ${item.currencyCode} ${item.price}`,
    )
    .join("\n");
  return [
    "You convert a pasted purchase order, email, or spreadsheet into catalog line items.",
    "Use ONLY variant_id values that appear in the catalog below — never invent one.",
    "If a line cannot be confidently matched to a catalog variant, put its original",
    "text verbatim into `unmatched` instead of guessing. Always respond via the",
    "submit_parsed_order tool.",
    "",
    "Catalog (SKU | Title | variant_id | price):",
    rows,
  ].join("\n");
}

/** Coerce arbitrary tool input into a well-formed ParsedOrderResult. */
function normalizeParsed(input: unknown): ParsedOrderResult {
  const obj = (input ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(obj.lines) ? obj.lines : [];
  const lines: ParsedOrderLine[] = rawLines
    .map((l) => l as Record<string, unknown>)
    .filter((l) => typeof l.variant_id === "string")
    .map((l) => ({
      variant_id: String(l.variant_id),
      sku: typeof l.sku === "string" ? l.sku : null,
      quantity: Number(l.quantity),
      raw_text: typeof l.raw_text === "string" ? l.raw_text : "",
    }));
  const unmatched = Array.isArray(obj.unmatched)
    ? obj.unmatched.filter((u): u is string => typeof u === "string")
    : [];
  return { lines, unmatched };
}

/**
 * Validate the model's proposal against the live catalog. Every variant_id that
 * isn't in the catalog is dropped and its raw text moved to `unmatched`.
 * Quantities are clamped to integers ≥ 1. Pure — this is the security boundary,
 * and it's exhaustively tested.
 */
export function validateParsedOrder(
  parsed: ParsedOrderResult,
  catalog: CatalogItem[],
): ValidatedOrder {
  const byVariant = new Map(catalog.map((c) => [c.variantId, c]));
  const matched: MatchedLine[] = [];
  const unmatched: string[] = [...parsed.unmatched];

  for (const line of parsed.lines) {
    const item = byVariant.get(line.variant_id);
    if (!item) {
      unmatched.push(line.raw_text || line.variant_id);
      continue;
    }
    const quantity = Math.max(1, Math.floor(Number.isFinite(line.quantity) ? line.quantity : 1));
    matched.push({
      variantId: item.variantId,
      sku: item.sku,
      title: item.displayTitle,
      quantity,
      price: item.price,
      rawText: line.raw_text,
    });
  }

  const proposed = parsed.lines.length;
  const acceptedAsIsRate = proposed === 0 ? 0 : matched.length / proposed;
  return { matched, unmatched, acceptedAsIsRate };
}

export type OrderParseInvoke = (input: {
  systemPrompt: string;
  blob: string;
}) => Promise<ParsedOrderResult>;

/** Real model call. Forced tool, temperature 0, cached catalog prefix. */
export const invokeHaiku: OrderParseInvoke = async ({ systemPrompt, blob }) => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ],
    tools: [SUBMIT_PARSED_ORDER_TOOL],
    tool_choice: { type: "tool", name: "submit_parsed_order" },
    messages: [{ role: "user", content: blob }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a parsed order");
  }
  return normalizeParsed(toolUse.input);
};

/**
 * Parse a pasted order: call the model (injectable), then validate its output
 * against the live catalog. Returns matched lines + unmatched text + rate.
 */
export async function parseOrderPad(
  blob: string,
  catalog: CatalogItem[],
  options: { invoke?: OrderParseInvoke } = {},
): Promise<ValidatedOrder> {
  const invoke = options.invoke ?? invokeHaiku;
  const systemPrompt = buildCatalogSystemPrompt(catalog);
  const parsed = await invoke({ systemPrompt, blob });
  return validateParsedOrder(parsed, catalog);
}
