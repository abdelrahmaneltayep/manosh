import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { verifyMagicToken } from "../services/magic-link.server";
import { commitBuyerSession } from "../services/buyer-session.server";

type LoaderData =
  | { state: "valid"; email: string; token: string }
  | { state: "invalid" }
  | { state: "expired" };

// GET: peek at the token (no consumption) so email link-scanners can't burn it,
// then show a "Continue" button that POSTs to actually sign in.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = new URL(request.url).searchParams.get("token");
  const result = await verifyMagicToken(token, { consume: false });
  if (!result.ok) {
    return { state: result.reason } satisfies LoaderData;
  }
  return {
    state: "valid",
    email: result.buyer.email,
    token: token as string,
  } satisfies LoaderData;
};

// POST: atomically consume the token (single-use) and start the buyer session.
export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const result = await verifyMagicToken(token, { consume: true });
  if (!result.ok) {
    // Re-render the notice via a redirect back to the GET with the (now
    // invalid) token so the buyer sees a clear expired/invalid message.
    return redirect(`/portal/auth?token=${encodeURIComponent(token)}`);
  }
  const cookie = await commitBuyerSession(result.buyer.id);
  return redirect("/portal", { headers: { "Set-Cookie": cookie } });
};

export default function PortalAuth() {
  const data = useLoaderData<typeof loader>();

  if (data.state === "valid") {
    return (
      <section className="portal-card">
        <h1>Sign in to your wholesale portal</h1>
        <p className="muted">
          You&rsquo;re signing in as <strong>{data.email}</strong>.
        </p>
        <Form method="post" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="token" value={data.token} />
          <button type="submit" className="portal-button">
            Continue
          </button>
        </Form>
      </section>
    );
  }

  return (
    <section className="portal-card">
      <h1>This link can&rsquo;t be used</h1>
      <p className="error">
        {data.state === "expired"
          ? "This sign-in link has expired."
          : "This sign-in link is invalid or has already been used."}
      </p>
      <p className="muted">
        Ask your supplier to send you a new link, then open it from your email.
      </p>
    </section>
  );
}
