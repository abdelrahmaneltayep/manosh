import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DELIVERY_CLAIM, EMAIL_OFF_NOTICE, emailCopy, type EmailCopy } from "./email-delivery";

function strings(copy: EmailCopy): string[] {
  return Object.values(copy).flatMap((value) =>
    typeof value === "function"
      ? [(value as (arg: never) => string)(true as never), (value as (arg: never) => string)(false as never)]
      : [value],
  );
}

describe("emailCopy", () => {
  it("makes no delivery claim while delivery is off", () => {
    for (const text of [...strings(emailCopy(false)), EMAIL_OFF_NOTICE]) {
      // "sender" is the thing that is missing, not a claim that something goes out.
      expect(text.replace(/\bsender\b/gi, ""), text).not.toMatch(DELIVERY_CLAIM);
    }
  });

  it("keeps the original send labels for when delivery is on", () => {
    const on = emailCopy(true);
    expect(on.quotePdfAction).toBe("Email PDF to buyer");
    expect(on.reminderAction(false)).toBe("Send default reminder");
    expect(on.repInviteAction).toBe("Send invite");
    expect(on.applicationsIntro).toContain("Each decision emails the applicant");
  });

  it("offers a Copy action for each send action while delivery is off", () => {
    const off = emailCopy(false);
    expect(off.quotePdfAction).toBe("Copy buyer link");
    expect(off.reminderAction(false)).toBe("Copy reminder");
    expect(off.reminderAction(true)).toBe("Copy this message");
  });
});

// The labels that promise a delivery must come from emailCopy(), which swaps
// them for Copy actions while no sender is connected. A route that hard-codes
// one would bring the false promise back.
describe("routes", () => {
  const PROMISES = [
    "Email PDF to buyer",
    "Send default reminder",
    "Send this message",
    "Send invite",
    "Send decision",
    "Each decision emails the applicant",
    "has been emailed",
    "Check your email",
    "Quote PDF emailed",
  ];
  // These show the promise only behind an explicit delivery check.
  const GUARDED: Record<string, string[]> = {
    "portal.team.tsx": ["Send invite"],
    "apply.$shop.tsx": ["Check your email"],
    "app.catalog-sharing._index.tsx": ["has been emailed"],
    "app.quotes.$id.tsx": ["Quote PDF emailed"],
  };

  it("hard-code no delivery promise outside a delivery check", () => {
    const dir = "app/routes";
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".tsx") || name.includes(".test.")) continue;
      const source = readFileSync(join(dir, name), "utf8");
      for (const phrase of PROMISES) {
        if (!source.includes(phrase)) continue;
        if (GUARDED[name]?.includes(phrase) && /emailDelivery|res\.access/.test(source)) continue;
        offenders.push(`${name}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
