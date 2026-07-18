import { createCookieSessionStorage, redirect } from "@remix-run/node";

/**
 * Buyer portal session (S4). Entirely separate from the Shopify admin session:
 * the portal is non-embedded, so it uses its own signed HTTP-only cookie that
 * carries just the authenticated buyer id.
 */

const SESSION_SECRET =
  process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me";

if (
  process.env.NODE_ENV === "production" &&
  SESSION_SECRET === "dev-insecure-session-secret-change-me"
) {
  // Fail loudly in prod rather than sign cookies with a known secret.
  throw new Error("SESSION_SECRET must be set in production");
}

const BUYER_ID_KEY = "buyerId";
// 7 days — a buyer stays signed in without re-clicking the (single-use) link.
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const storage = createCookieSessionStorage({
  cookie: {
    name: "__mannon_portal",
    httpOnly: true,
    sameSite: "lax",
    path: "/portal",
    secure: process.env.NODE_ENV === "production",
    secrets: [SESSION_SECRET],
    maxAge: SESSION_MAX_AGE,
  },
});

/** Create a signed session for a buyer and return the Set-Cookie header value. */
export async function commitBuyerSession(buyerId: string): Promise<string> {
  const session = await storage.getSession();
  session.set(BUYER_ID_KEY, buyerId);
  return storage.commitSession(session);
}

/** Read the authenticated buyer id from the request cookie, or null. */
export async function getBuyerId(request: Request): Promise<string | null> {
  const session = await storage.getSession(request.headers.get("Cookie"));
  const buyerId = session.get(BUYER_ID_KEY);
  return typeof buyerId === "string" ? buyerId : null;
}

/**
 * Require an authenticated buyer. Returns the buyer id, or throws a redirect to
 * the portal sign-in notice when there is no valid session.
 */
export async function requireBuyerId(
  request: Request,
  redirectTo = "/portal/signin",
): Promise<string> {
  const buyerId = await getBuyerId(request);
  if (!buyerId) {
    throw redirect(redirectTo);
  }
  return buyerId;
}

/** Destroy the buyer session; returns the Set-Cookie header value. */
export async function destroyBuyerSession(request: Request): Promise<string> {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return storage.destroySession(session);
}
