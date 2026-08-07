import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F12 sales-rep portal — Claude drafts a short, warm personal note to include in
 * a rep's invite email. The output pre-fills an editable field; the merchant
 * reviews and sends the invite (guardrail #4). The secure sign-in link is added
 * by the invite plumbing.
 */

export interface RepInviteNoteInput {
  repName: string;
  shopName: string;
}

export const REP_INVITE_NOTE_TOOL: AnthropicSDK.Tool = {
  name: "draft_rep_invite_note",
  description: "Return a short, warm personal note to include in a sales-rep's invite email.",
  input_schema: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description:
          "A 1-2 sentence personal welcome for the rep joining the team's portal. No links or sign-off — the secure link is added automatically.",
      },
    },
    required: ["note"],
  },
};

export const repInviteNoteFeature = registerFeature<RepInviteNoteInput>({
  key: "rep_invite_note",
  system: withSharedRules(
    [
      "Task: write a short, warm personal note welcoming a sales rep to a wholesale team's portal.",
      "Friendly and encouraging; make them feel welcomed onto the team.",
      "1-2 sentences. No links, no sign-off (added automatically).",
    ].join("\n"),
  ),
  tool: REP_INVITE_NOTE_TOOL,
  buildUser: (input) => {
    return [
      input.repName && input.repName !== "there" ? `Rep name: ${input.repName}` : "Rep name: (not provided)",
      `Team / store: ${input.shopName}`,
    ].join("\n");
  },
});
