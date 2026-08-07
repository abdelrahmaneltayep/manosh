import prisma from "../db.server";
import { draft, type ClaudeInvoke } from "./claude.server";
import type { WholesaleDecision } from "./prompts/wholesale-decision";

/**
 * F6 wholesale registration — DB orchestration for the Claude decision-note
 * draft. Loads the owned application, calls draft() with the wholesale_decision
 * feature for the chosen decision, and returns the note to pre-fill the
 * merchant's editable field. Nothing is sent here.
 */

export const WHOLESALE_DECISIONS: readonly WholesaleDecision[] = ["APPROVED", "REJECTED", "MORE_INFO"];

/** Validate an arbitrary string is one of the three decisions. Pure. */
export function isWholesaleDecision(value: string): value is WholesaleDecision {
  return (WHOLESALE_DECISIONS as readonly string[]).includes(value);
}

export interface DecisionNoteDraft {
  applicationId: string;
  decision: WholesaleDecision;
  note: string;
}

/** Draft a decision note for one owned application. Returns null when missing. */
export async function draftDecisionNote(
  shopDomain: string,
  applicationId: string,
  decision: WholesaleDecision,
  options: { invoke?: ClaudeInvoke } = {},
): Promise<DecisionNoteDraft | null> {
  const app = await prisma.wholesaleApplication.findFirst({
    where: { id: applicationId, shop: { shopifyDomain: shopDomain } },
    select: { id: true, companyName: true, shop: { select: { id: true } } },
  });
  if (!app) return null;

  const { output } = await draft({
    feature: "wholesale_decision",
    shopId: app.shop.id,
    input: { companyName: app.companyName, decision },
    invoke: options.invoke,
  });

  const note = typeof output.note === "string" ? output.note.trim() : "";
  return { applicationId, decision, note };
}
