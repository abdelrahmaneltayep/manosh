import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { verifyRepToken, REP_PORTAL_ENABLED } from "../services/rep.server";
import { commitRepSession } from "../services/rep-session.server";

type LoaderData = { state: "valid"; email: string; token: string } | { state: "invalid" } | { state: "expired" };

// GET: peek at the token (no consumption) so email link-scanners can't burn it.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!REP_PORTAL_ENABLED()) throw new Response("Not found", { status: 404 });
  const token = new URL(request.url).searchParams.get("token");
  const result = await verifyRepToken(token, { consume: false });
  if (!result.ok) return { state: result.reason } satisfies LoaderData;
  return { state: "valid", email: result.rep.email, token: token as string } satisfies LoaderData;
};

// POST: atomically consume the token (single-use, activates the rep) + sign in.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!REP_PORTAL_ENABLED()) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const result = await verifyRepToken(token, { consume: true });
  if (!result.ok) return redirect(`/rep/auth?token=${encodeURIComponent(token)}`);
  const cookie = await commitRepSession(result.rep.id);
  return redirect("/rep", { headers: { "Set-Cookie": cookie } });
};

export default function RepAuth() {
  const data = useLoaderData<typeof loader>();

  if (data.state === "valid") {
    return (
      <section className="portal-card">
        <h1>Sign in to your rep portal</h1>
        <p className="muted">You&rsquo;re signing in as <strong>{data.email}</strong>.</p>
        <Form method="post" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="token" value={data.token} />
          <button type="submit" className="portal-button">Continue</button>
        </Form>
      </section>
    );
  }

  return (
    <section className="portal-card">
      <h1>This link can&rsquo;t be used</h1>
      <p className="error">
        {data.state === "expired" ? "This sign-in link has expired." : "This sign-in link is invalid or has already been used."}
      </p>
      <p className="muted">Ask your manager to send you a new invite link.</p>
    </section>
  );
}
