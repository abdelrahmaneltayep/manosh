import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F14 tax/VAT — Claude drafts the reason a buyer sees when their tax-exemption
 * profile can't be verified: a polite explanation and exactly what to re-submit.
 * The output pre-fills the merchant's reason field; they review and click Reject,
 * which emails the buyer that reason (guardrail #4).
 */

export interface TaxRejectNoteInput {
  companyName: string;
  taxIdType: string | null;
  hasCertificate: boolean;
}

export const TAX_REJECT_NOTE_TOOL: AnthropicSDK.Tool = {
  name: "draft_tax_reject_note",
  description: "Return a polite reason explaining why a tax-exemption profile can't be verified and what to re-submit.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description:
          "A courteous 1-3 sentence explanation that the exemption couldn't be verified and precisely what the buyer should re-submit (a valid certificate and/or a matching tax ID). No links or sign-off.",
      },
    },
    required: ["reason"],
  },
};

export const taxRejectNoteFeature = registerFeature<TaxRejectNoteInput>({
  key: "tax_reject_note",
  system: withSharedRules(
    [
      "Task: explain, kindly, why a wholesale buyer's tax-exemption documents can't be verified yet.",
      "Be specific and helpful about what to provide next; never accuse or imply wrongdoing.",
      "Do not promise the exemption will be granted. 1-3 sentences. No links or sign-off.",
    ].join("\n"),
  ),
  tool: TAX_REJECT_NOTE_TOOL,
  buildUser: (input) => {
    return [
      `Company: ${input.companyName}`,
      input.taxIdType ? `Tax ID type on file: ${input.taxIdType}` : "No tax ID on file.",
      input.hasCertificate ? "A certificate was uploaded but could not be verified." : "No exemption certificate was uploaded.",
    ].join("\n");
  },
});
