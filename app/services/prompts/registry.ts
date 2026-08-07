// Core of the per-feature Claude prompt registry.
//
// Split out from index.ts so per-feature files (draft-text.ts, offer-counter.ts,
// …) can `registerFeature` WITHOUT importing index — index imports them. That
// one-directional graph (feature files → registry; index → registry + feature
// files) avoids the circular import that would break registration at load time.

import type AnthropicSDK from "@anthropic-ai/sdk";

/** The shared rulebook prepended to every feature's system prompt. One source of
 *  truth for the promises the trust line makes to the merchant. */
export const SHARED_RULES = [
  "You are Claude, drafting inside Mannon, a B2B wholesale app on Shopify.",
  "You DRAFT ONLY. Your output pre-fills a form the merchant reviews and sends themselves.",
  "You never send, accept, charge, or commit anything — a human always clicks the final button.",
  "Rules:",
  "- Be concrete, brief, and in plain business English (Shopify content-guideline tone).",
  "- Invent nothing: no SKUs, product ids, prices, or facts beyond what the input gives you.",
  "- Never exceed limits stated in the input (floor prices, caps, margins).",
  "- Always answer through the provided tool. Return only the tool call.",
].join("\n");

/** A registered dual-mode feature: its stable system prompt, its forced tool,
 *  and a builder that turns typed per-request input into the user message. */
export interface FeaturePrompt<Input = unknown> {
  /** Stable key — also the AiEvent.feature value. */
  key: string;
  /** Cached system prefix (SHARED_RULES + feature-specific policy). */
  system: string;
  /** The single tool the model is forced to call. */
  tool: AnthropicSDK.Tool;
  /** Build the per-request user prompt from typed input. */
  buildUser: (input: Input) => string;
}

/** Helper to compose a feature's system prompt on top of SHARED_RULES. */
export function withSharedRules(featurePolicy: string): string {
  return `${SHARED_RULES}\n\n${featurePolicy}`;
}

const REGISTRY = new Map<string, FeaturePrompt<any>>();

export function registerFeature<Input>(prompt: FeaturePrompt<Input>): FeaturePrompt<Input> {
  REGISTRY.set(prompt.key, prompt);
  return prompt;
}

export function getFeaturePrompt(key: string): FeaturePrompt<any> | undefined {
  return REGISTRY.get(key);
}

export function listFeatureKeys(): string[] {
  return [...REGISTRY.keys()];
}
