import type AnthropicSDK from "@anthropic-ai/sdk";
import { registerFeature, withSharedRules } from "./registry";

/**
 * AI-15 Credit-risk flag — reads a company's payment behaviour and returns an
 * advisory risk level, rationale, and a recommendation. Dual-mode + guardrail #4:
 * this NEVER changes a credit limit or terms — it's a read the merchant acts on
 * (or ignores). Reasoning is grounded only in the numbers provided.
 */

export interface CreditRiskInput {
  companyName: string;
  currency: string;
  creditLimit: string;
  outstandingBalance: string;
  overdueInvoices: number;
  avgDaysLate: number;
  termsDays: number;
  ordersLast90: number;
}

export const CREDIT_RISK_TOOL: AnthropicSDK.Tool = {
  name: "draft_credit_risk",
  description: "Return an advisory credit-risk read for a wholesale company.",
  input_schema: {
    type: "object",
    properties: {
      level: {
        type: "string",
        enum: ["low", "watch", "high"],
        description:
          "'high' when there are overdue invoices AND meaningful average lateness or near/over-limit balance; 'watch' for early warning signs; 'low' otherwise.",
      },
      rationale: {
        type: "string",
        description: "1-2 sentences citing the specific numbers that drove the level.",
      },
      recommendation: {
        type: "string",
        description:
          "One concrete, reversible suggestion the merchant could consider (e.g. shorten terms, request a deposit, hold new orders). Advisory only.",
      },
    },
    required: ["level", "rationale", "recommendation"],
  },
};

export const creditRiskFlagFeature = registerFeature<CreditRiskInput>({
  key: "credit_risk_flag",
  system: withSharedRules(
    [
      "Task: assess a wholesale company's credit risk from its payment behaviour and recommend a next step.",
      "Ground the level strictly in the numbers: overdue invoices, average days late, balance vs limit, recent order volume.",
      "This is advisory only — never state that a limit or terms have been changed. Recommend reversible actions the merchant chooses to take.",
      "Do not invent history or numbers beyond the input.",
    ].join("\n"),
  ),
  tool: CREDIT_RISK_TOOL,
  buildUser: (input) =>
    [
      `Company: ${input.companyName}`,
      `Credit limit: ${input.creditLimit} ${input.currency}`,
      `Outstanding balance: ${input.outstandingBalance} ${input.currency}`,
      `Overdue invoices: ${input.overdueInvoices}`,
      `Average days late (paid invoices): ${input.avgDaysLate}`,
      `Payment terms: net ${input.termsDays}`,
      `Orders in last 90 days: ${input.ordersLast90}`,
    ].join("\n"),
});
