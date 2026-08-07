import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * F2 email templates — Claude drafts the subject + body for an invoice or
 * reminder email. The output pre-fills the merchant's template fields; they
 * review and Save (guardrail #4). Every {{token}} in the current copy MUST be
 * preserved and no new token invented (validated by preserving the existing set).
 */

export interface EmailTemplateInput {
  label: string; // e.g. "Reminder — 7 days overdue"
  currentSubject: string;
  currentBody: string;
}

export const EMAIL_TEMPLATE_TOOL: AnthropicSDK.Tool = {
  name: "draft_email_template",
  description: "Return an improved subject and body for a B2B invoice/reminder email.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "The email subject line. Keep it short and clear." },
      body: {
        type: "string",
        description:
          "The email body. Professional, warm, and concise. Preserve every {{token}} present in the current copy exactly; do NOT introduce new {{tokens}}.",
      },
    },
    required: ["subject", "body"],
  },
};

export const emailTemplateFeature = registerFeature<EmailTemplateInput>({
  key: "email_template",
  system: withSharedRules(
    [
      "Task: write the subject and body of a B2B invoice or payment-reminder email.",
      "Professional, courteous, and concise — appropriate for a wholesale buyer.",
      "Preserve EVERY {{token}} that appears in the current copy, spelled exactly.",
      "Never invent a new {{token}}. Match the intent of the template's label (e.g. an",
      "overdue reminder is firmer than an invoice-issued note).",
    ].join("\n"),
  ),
  tool: EMAIL_TEMPLATE_TOOL,
  buildUser: (input) => {
    return [
      `Template: ${input.label}`,
      "",
      `Current subject: ${input.currentSubject}`,
      "Current body:",
      input.currentBody,
    ].join("\n");
  },
});
