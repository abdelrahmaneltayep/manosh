import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { verifyUnsubscribeToken, unsubscribeQuote } from "../services/followups.server";

// Public unsubscribe landing (from a follow-up email). No login — a signed token
// in the link authorises stopping reminders for this quote.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const quoteId = params.id!;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const ok = verifyUnsubscribeToken(quoteId, token);
  if (ok) await unsubscribeQuote(quoteId);
  return { ok };
};

export default function Unsubscribe() {
  const { ok } = useLoaderData<typeof loader>();
  return (
    <section className="portal-card">
      <h1>{ok ? "Reminders stopped" : "Link not valid"}</h1>
      <p className="muted">
        {ok
          ? "You won't get any more reminders about this quote. You can still open it any time to accept or counter."
          : "This unsubscribe link is invalid or has expired."}
      </p>
      <p style={{ marginTop: "1rem" }}>
        <Link to="/portal" className="portal-link">← Back to your portal</Link>
      </p>
    </section>
  );
}
