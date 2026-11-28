import { describe, expect, it } from "vitest";
import { checkTemplate, placeholders, renderPreview, sampleValues, templateProblem } from "./template-check";

const DEFAULT = { subject: "Your quote from {{shopName}}", body: "Hi {{buyerName}}, open it: {{quoteUrl}} (until {{expiresAt}})" };

describe("checkTemplate", () => {
  it("passes an edit that keeps the link and uses known placeholders", () => {
    const check = checkTemplate(DEFAULT, { subject: "Quote ready", body: "Hello {{buyerName}} — {{quoteUrl}}" });
    expect(check).toEqual({ missing: [], unknown: [] });
    expect(templateProblem(check)).toBeNull();
  });

  it("blocks an edit that drops the link", () => {
    const check = checkTemplate(DEFAULT, { subject: "Quote ready", body: "Hello {{buyerName}}" });
    expect(check.missing).toEqual(["quoteUrl"]);
    expect(templateProblem(check)).toMatch(/Put back \{\{quoteUrl\}\}/);
  });

  it("flags a placeholder Mannon can't fill", () => {
    const check = checkTemplate(DEFAULT, { subject: "Hi {{firstName}}", body: "{{quoteUrl}}" });
    expect(check.unknown).toEqual(["firstName"]);
    expect(templateProblem(check)).toMatch(/can’t fill \{\{firstName\}\}/);
  });
});

describe("preview", () => {
  it("fills every placeholder with a sample and keeps unknown ones visible", () => {
    const values = sampleValues(placeholders(DEFAULT));
    const preview = renderPreview({ subject: DEFAULT.subject, body: `${DEFAULT.body} {{oops}}` }, values);
    expect(preview.subject).toBe("Your quote from Harbor Coffee Wholesale");
    expect(preview.body).toContain("Sam Rivera");
    expect(preview.body).toContain("https://example.com/link");
    expect(preview.body).toContain("{{oops}}");
  });
});
