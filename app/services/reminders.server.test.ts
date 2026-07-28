import { describe, it, expect } from "vitest";
import { stageFor } from "./reminders.server";
import {
  renderTemplate,
  resolveTemplate,
  DEFAULT_TEMPLATES,
} from "./mailer.server";

const NOW = new Date("2026-07-27T12:00:00Z");

describe("stageFor (which reminder is due)", () => {
  it("returns T-3 exactly three days before due", () => {
    expect(stageFor({ status: "OPEN", dueDate: "2026-07-30T12:00:00Z" }, NOW)).toBe("T_MINUS_3");
  });
  it("returns DUE on the due date", () => {
    expect(stageFor({ status: "OPEN", dueDate: "2026-07-27T12:00:00Z" }, NOW)).toBe("DUE");
  });
  it("returns OVERDUE_7 seven days past due", () => {
    expect(stageFor({ status: "OVERDUE", dueDate: "2026-07-20T12:00:00Z" }, NOW)).toBe("OVERDUE_7");
  });
  it("returns null on an off day", () => {
    expect(stageFor({ status: "OPEN", dueDate: "2026-07-29T12:00:00Z" }, NOW)).toBeNull();
  });
  it("never fires for PAID/VOID invoices", () => {
    expect(stageFor({ status: "PAID", dueDate: "2026-07-27T12:00:00Z" }, NOW)).toBeNull();
    expect(stageFor({ status: "VOID", dueDate: "2026-07-24T12:00:00Z" }, NOW)).toBeNull();
  });
});

describe("templates", () => {
  it("fills placeholders and leaves unknown tokens blank", () => {
    const { subject, body } = renderTemplate(
      { subject: "Invoice {{invoiceNumber}}", body: "Hi {{buyerName}}, due {{dueDate}}. {{missing}}" },
      { invoiceNumber: "AB12", buyerName: "Layla", dueDate: "2026-08-01" },
    );
    expect(subject).toBe("Invoice AB12");
    expect(body).toBe("Hi Layla, due 2026-08-01. ");
  });

  it("uses shop overrides when present, else the default", () => {
    const overridden = resolveTemplate("reminder_due", {
      reminder_due: { subject: "Custom due subject" },
    });
    expect(overridden.subject).toBe("Custom due subject");
    // body falls back to default
    expect(overridden.body).toBe(DEFAULT_TEMPLATES.reminder_due.body);
  });
});
