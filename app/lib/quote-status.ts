import type { QuoteStatus } from "@prisma/client";

export type BadgeTone =
  | "info"
  | "success"
  | "attention"
  | "warning"
  | "critical"
  | undefined;

// Plain-language labels + Polaris Badge tones for each status. "New" reads
// better than "Submitted" for a merchant scanning their inbox for action.
export function quoteStatusBadge(status: QuoteStatus): {
  label: string;
  tone: BadgeTone;
} {
  switch (status) {
    case "SUBMITTED":
      return { label: "New", tone: "attention" };
    case "COUNTERED":
      return { label: "Countered", tone: "info" };
    case "ACCEPTED":
      return { label: "Accepted", tone: "success" };
    case "ORDERED":
      return { label: "Ordered", tone: "success" };
    case "EXPIRED":
      return { label: "Expired", tone: undefined };
  }
}
