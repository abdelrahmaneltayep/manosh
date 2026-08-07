import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F19 catalog sharing — Claude drafts a compelling public TITLE for a shared
 * wholesale catalog (the headline buyers see in the discovery listing). The
 * output pre-fills the merchant's title field; they review and create/publish
 * (guardrail #4).
 */

export interface CatalogTitleInput {
  catalogName: string;
  currentTitle: string;
}

export const CATALOG_TITLE_TOOL: AnthropicSDK.Tool = {
  name: "draft_catalog_title",
  description: "Return a compelling, concise public title for a shared wholesale catalog.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "A concise public catalog title (3-6 words) that reads well in a B2B discovery listing. Title case, no trailing punctuation.",
      },
    },
    required: ["title"],
  },
};

export const catalogTitleFeature = registerFeature<CatalogTitleInput>({
  key: "catalog_title",
  system: withSharedRules(
    [
      "Task: write a public title for a wholesale catalog shown to prospective B2B buyers.",
      "Clear and appealing; hint at what's inside without overstating. 3-6 words, title case,",
      "no trailing punctuation. Base it on the catalog's internal name — invent no products.",
    ].join("\n"),
  ),
  tool: CATALOG_TITLE_TOOL,
  buildUser: (input) => {
    return [
      `Internal catalog name: ${input.catalogName || "(unnamed)"}`,
      input.currentTitle ? `Current public title: ${input.currentTitle}` : "No public title yet.",
      "Return one strong public title.",
    ].join("\n");
  },
});
