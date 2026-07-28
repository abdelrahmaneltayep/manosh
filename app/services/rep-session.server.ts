import { createCookieSessionStorage, redirect } from "@remix-run/node";

/**
 * F12 — sales-rep portal session. Separate from both the Shopify admin session
 * and the buyer portal session: reps get their own signed HTTP-only cookie
 * (scoped to /rep) carrying just the authenticated rep id.
 */

const SESSION_SECRET =
  process.env.SESSION_SECRET ?? "dev-insecure-session-secret-change-me";

if (
  process.env.NODE_ENV === "production" &&
  SESSION_SECRET === "dev-insecure-session-secret-change-me"
) {
  throw new Error("SESSION_SECRET must be set in production");
}

const REP_ID_KEY = "repId";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const storage = createCookieSessionStorage({
  cookie: {
    name: "__mannon_rep",
    httpOnly: true,
    sameSite: "lax",
    path: "/rep",
    secure: process.env.NODE_ENV === "production",
    secrets: [SESSION_SECRET],
    maxAge: SESSION_MAX_AGE,
  },
});

export async function commitRepSession(repId: string): Promise<string> {
  const session = await storage.getSession();
  session.set(REP_ID_KEY, repId);
  return storage.commitSession(session);
}

export async function getRepId(request: Request): Promise<string | null> {
  const session = await storage.getSession(request.headers.get("Cookie"));
  const repId = session.get(REP_ID_KEY);
  return typeof repId === "string" ? repId : null;
}

export async function requireRepId(request: Request, redirectTo = "/rep/signin"): Promise<string> {
  const repId = await getRepId(request);
  if (!repId) throw redirect(redirectTo);
  return repId;
}

export async function destroyRepSession(request: Request): Promise<string> {
  const session = await storage.getSession(request.headers.get("Cookie"));
  return storage.destroySession(session);
}
