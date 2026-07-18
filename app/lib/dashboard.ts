// Client-safe dashboard constants. Kept out of dashboard.server.ts so routes
// can reference them in render without pulling server-only code into the client
// bundle (Remix rejects a ".server" import used outside loader/action).

/**
 * Display threshold for the "expiring soon" list. This is a dashboard view
 * knob, not the merchant's quote lifetime (that's the `quoteExpiryDays`
 * setting) — it's how many days ahead we surface quotes that need attention.
 */
export const EXPIRING_SOON_DAYS = 3;
