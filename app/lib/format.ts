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

// Money is formatted for DISPLAY only here (Number() is fine for rendering; it
// is never used to compute or sum totals — see dashboard.server.ts for exact
// decimal addition). Fixed locale keeps server/client output identical.
export function formatMoney(amount: string, currencyCode: string): string {
  const value = Number(amount);
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
    }).format(safe);
  } catch {
    // Unknown currency code → fall back to the code + fixed 2dp amount.
    return `${currencyCode} ${safe.toFixed(2)}`;
  }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Human, deterministic duration for the "median time to quote" tile.
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < MINUTE) return "under a minute";
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const mins = Math.round((ms % HOUR) / MINUTE);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(ms / DAY);
  const hours = Math.round((ms % DAY) / HOUR);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}
