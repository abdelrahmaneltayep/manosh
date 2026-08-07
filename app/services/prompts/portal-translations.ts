import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F16 i18n — Claude drafts translations of the buyer-portal UI strings into a
 * target language. The output pre-fills the merchant's custom-translations JSON;
 * they review and save it themselves (guardrail #4). The server validates every
 * returned key against the known string catalog before use.
 */

export interface TranslationsInput {
  localeCode: string;
  localeName: string;
  /** The canonical English key → string map (the source of truth). */
  sourceStrings: Record<string, string>;
}

export const TRANSLATIONS_TOOL: AnthropicSDK.Tool = {
  name: "draft_translations",
  description:
    "Return translations of the given UI strings into the target language, as a flat object of the SAME keys mapped to translated values.",
  input_schema: {
    type: "object",
    properties: {
      translations: {
        type: "object",
        description:
          "Object keyed by the EXACT same keys as the source, each value the translated string. Preserve any {{token}} placeholders verbatim.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["translations"],
  },
};

export const portalTranslationsFeature = registerFeature<TranslationsInput>({
  key: "portal_translations",
  system: withSharedRules(
    [
      "Task: translate short e-commerce UI labels for a wholesale buyer portal.",
      "Keep the SAME keys; translate only the values into the target language.",
      "Preserve every {{token}} placeholder exactly (do not translate or reorder its name).",
      "Use natural, concise commerce phrasing a native speaker would expect.",
    ].join("\n"),
  ),
  tool: TRANSLATIONS_TOOL,
  buildUser: (input) => {
    const rows = Object.entries(input.sourceStrings)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");
    return [
      `Target language: ${input.localeName} (${input.localeCode})`,
      "",
      "Translate the value of each key. Return the same keys via the tool.",
      "",
      rows,
    ].join("\n");
  },
});
