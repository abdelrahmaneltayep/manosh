import { describe, it, expect } from "vitest";
import { emailTemplateFeature } from "./email-template";

describe("email_template prompt", () => {
  it("carries the label and current copy for token preservation", () => {
    const user = emailTemplateFeature.buildUser({
      label: "Reminder — 7 days overdue",
      currentSubject: "Invoice {{invoiceNumber}} is overdue",
      currentBody: "Hi {{buyerName}}, {{amount}} is now overdue. Pay: {{invoiceUrl}}",
    });
    expect(user).toContain("Template: Reminder — 7 days overdue");
    expect(user).toContain("{{invoiceNumber}}");
    expect(user).toContain("{{buyerName}}");
    expect(user).toContain("{{invoiceUrl}}");
  });
});
