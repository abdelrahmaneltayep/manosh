import type { ActionFunctionArgs, HeadersFunction, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import portalStyles from "../styles/portal.css?url";
import { getPayLink, redeemPayLink, FLEX_PAY_ENABLED } from "../services/payments.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: portalStyles }];

// Public, standalone, no login. Forbid framing.
export const headers: HeadersFunction = () => ({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
});

// GET: look up the link by opaque token (no amount/PII in the URL). Peek only.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  if (!FLEX_PAY_ENABLED()) throw new Response("Not found", { status: 404 });
  const view = await getPayLink(params.token ?? "");
  if (!view) throw new Response("Not found", { status: 404 });
  return { view };
};

// POST: redeem. In production this first hands off to Shopify-hosted checkout and
// completes on capture; here it settles the installment. Mannon never sees a card.
export const action = async ({ params }: ActionFunctionArgs) => {
  if (!FLEX_PAY_ENABLED()) throw new Response("Not found", { status: 404 });
  const result = await redeemPayLink(params.token ?? "");
  return result;
};

export default function Pay() {
  const { view } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (actionData?.ok) {
    return (
      <main className="portal">
        <section className="portal-card" role="status">
          <h1>Payment complete</h1>
          <p className="muted">Thank you — your payment of {view.currency} {view.amount} to {view.companyName} is confirmed.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="portal">
      <section className="portal-card">
        <h1>Secure payment</h1>
        <p className="muted">Pay <strong>{view.currency} {view.amount}</strong> to {view.companyName}.</p>
        {view.redeemable ? (
          <>
            <p className="muted">You’ll be taken to a secure Shopify checkout — no login needed. We never see your card details.</p>
            {actionData && !actionData.ok && <p className="error" role="alert">This link can’t be used ({actionData.reason}).</p>}
            <Form method="post" style={{ marginTop: "1rem" }}>
              <button type="submit" className="portal-button">Pay securely</button>
            </Form>
          </>
        ) : (
          <p className="error">This payment link {view.reason === "expired" ? "has expired" : view.reason === "used" ? "has already been used" : "isn’t active"}. Ask the store for a new one.</p>
        )}
      </section>
    </main>
  );
}
