import type AnthropicSDK from "@anthropic-ai/sdk";
import type { AiEvent, Prisma } from "@prisma/client";
import prisma from "../db.server";
import { CLAUDE_MODEL } from "../config/plans";
import { getFeaturePrompt } from "./prompts";

/**
 * The single Claude entry point for all 15 dual-mode features.
 *
 * Every "✦ Draft with Claude" action on every screen routes here. There is ONE
 * generic call — `draft({ feature, input, shopId })` — that looks the feature up
 * in the prompt registry (app/services/prompts), invokes Claude Haiku with the
 * feature's forced tool, records an append-only AiEvent, and returns the raw
 * validated tool output for the caller to map into its manual form.
 *
 * Guardrails (CLAUDE.md):
 * - #4 AI never acts autonomously: this returns a DRAFT only. It writes nothing
 *   to the domain (no quote/draft-order/cart mutation). The caller pre-fills a
 *   form and the merchant confirms. Any id in the output must be validated
 *   against the live catalog by the caller before use.
 * - Temperature 0, forced tool, cached system prefix (tech stack).
 * - The model is fixed to claude-haiku-4-5 (CLAUDE_MODEL) — features never pick
 *   their own model.
 */

/** Injectable model call so features + tests never hit the network in unit tests. */
export interface ClaudeInvokeArgs {
  system: string;
  user: string;
  tool: AnthropicSDK.Tool;
}
export interface ClaudeInvokeResult {
  /** The tool's validated input object (the model's structured answer). */
  output: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
}
export type ClaudeInvoke = (args: ClaudeInvokeArgs) => Promise<ClaudeInvokeResult>;

/** The minimal Prisma surface `appendAiEvent` needs — an insert-only aiEvent
 *  create. Real `prisma` satisfies it; tests inject a lightweight fake. */
export interface AiEventCreateClient {
  aiEvent: { create: (args: { data: Prisma.AiEventUncheckedCreateInput }) => PromiseLike<AiEvent> };
}

export interface DraftParams<Input> {
  /** Registered feature key (app/services/prompts). */
  feature: string;
  /** Typed per-request input for that feature's `buildUser`. */
  input: Input;
  /** Shop cuid — for AiEvent attribution. */
  shopId: string;
  /** Test seam: inject a fake model call. */
  invoke?: ClaudeInvoke;
  /** Test seam: inject a Prisma client (for the AiEvent insert). */
  client?: AiEventCreateClient;
}

export interface DraftResult {
  /** The raw, validated tool output. Caller maps this into its manual form. */
  output: Record<string, unknown>;
  feature: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export class ClaudeConfigError extends Error {}

/**
 * The real Anthropic call. Forced tool, temperature 0, cached system prefix.
 * Reads ANTHROPIC_API_KEY from the environment (never logged, never returned).
 */
export const invokeClaude: ClaudeInvoke = async ({ system, user, tool }) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ClaudeConfigError(
      "Claude isn't configured for this store yet. Add an ANTHROPIC_API_KEY to enable drafting.",
    );
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: user }],
  });
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a draft.");
  }
  return {
    output: (toolUse.input ?? {}) as Record<string, unknown>,
    tokensIn: response.usage?.input_tokens ?? 0,
    tokensOut: response.usage?.output_tokens ?? 0,
  };
};

/**
 * Insert one AiEvent (append-only — insert only, no update/delete path). Records
 * WHICH feature Claude served and token usage. No PII: feature key + counts only.
 */
export async function appendAiEvent(
  input: { shopId: string; feature: string; mode?: string; tokensIn?: number; tokensOut?: number },
  client: AiEventCreateClient = prisma,
): Promise<AiEvent> {
  return client.aiEvent.create({
    data: {
      shopId: input.shopId,
      feature: input.feature,
      mode: input.mode ?? "claude",
      tokensIn: input.tokensIn ?? 0,
      tokensOut: input.tokensOut ?? 0,
    },
  });
}

/**
 * Draft with Claude for a registered feature. Generic across all 15 features.
 * Returns the raw tool output — the caller is responsible for validating ids and
 * pre-filling its manual form. Records an AiEvent (best-effort; a failed insert
 * never blocks returning the draft to the merchant).
 */
export async function draft<Input>(params: DraftParams<Input>): Promise<DraftResult> {
  const feature = getFeaturePrompt(params.feature);
  if (!feature) {
    throw new Error(`Unknown Claude feature: ${params.feature}`);
  }
  const invoke = params.invoke ?? invokeClaude;
  const user = feature.buildUser(params.input);
  const { output, tokensIn, tokensOut } = await invoke({
    system: feature.system,
    user,
    tool: feature.tool,
  });

  try {
    await appendAiEvent(
      { shopId: params.shopId, feature: feature.key, tokensIn, tokensOut },
      params.client,
    );
  } catch {
    // Analytics must never block the merchant's draft. Swallow + move on.
  }

  return { output, feature: feature.key, model: CLAUDE_MODEL, tokensIn, tokensOut };
}
