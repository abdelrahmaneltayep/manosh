// Fixed-locale formatters so server and client render identically (no
// hydration mismatch) and output is deterministic in tests.

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatDate(value: Date | string): string {
  return DATE_FMT.format(new Date(value));
}
