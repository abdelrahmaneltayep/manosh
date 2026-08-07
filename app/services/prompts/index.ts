// Per-feature prompt registry for the dual-mode Claude assistant.
//
// Each of the 15 dual-mode features registers ONE entry here: a stable system
// prompt (the cached prefix — role + hard rules) and a forced tool the model
// must answer through. Keeping every prompt in one typed registry means:
//   • claude.server.ts stays generic — it looks up `feature`, never hardcodes copy;
//   • every prompt inherits the same non-negotiable rules (temperature 0 is set
//     on the call; "pre-fill only, never act", "invent nothing" live here);
//   • adding feature N is a data change, not a code change.
//
// Guardrails (CLAUDE.md #4): Claude only DRAFTS — it pre-fills manual controls
// and never sends/accepts/charges. Any id the model returns MUST be validated
// against the live catalog by the caller before use; these prompts never treat a
// model-returned id as trusted.

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

// --- registry ----------------------------------------------------------------
// Features register themselves by importing this and calling `registerFeature`.
// (Each F1–F15 slice adds its own file under prompts/ and registers here.)

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

// --- F0 seed feature: a generic drafting helper -------------------------------
// A minimal registered feature so the foundation is exercisable end-to-end and
// tested before any of the 15 screens land. Later slices register richer ones.

export interface DraftTextInput {
  /** What the merchant is drafting, e.g. "a follow-up note for a stalled quote". */
  task: string;
  /** Free-form context lines (already PII-scrubbed by the caller if needed). */
  context?: string[];
}

export const DRAFT_TEXT_TOOL: AnthropicSDK.Tool = {
  name: "return_draft",
  description: "Return a short drafted text for the merchant to review, edit, and send.",
  input_schema: {
    type: "object",
    properties: {
      draft: {
        type: "string",
        description: "The drafted text, ready for the merchant to review and edit.",
      },
    },
    required: ["draft"],
  },
};

export const draftTextFeature = registerFeature<DraftTextInput>({
  key: "draft_text",
  system: withSharedRules(
    "Task: write a short, friendly, professional piece of text the merchant asked for.\n" +
      "Keep it under 120 words unless the input clearly needs more.",
  ),
  tool: DRAFT_TEXT_TOOL,
  buildUser: (input) => {
    const lines = [`Draft: ${input.task}`];
    if (input.context?.length) {
      lines.push("", "Context:", ...input.context.map((c) => `- ${c}`));
    }
    return lines.join("\n");
  },
});
