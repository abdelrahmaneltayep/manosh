import { Link, useLoaderData } from "@remix-run/react";
import { isDemoEnabled } from "../services/demo.server";

/**
 * Demo hub: two ways in. The buyer side is live on the demo store; the merchant
 * side is a guided tour of sample screens (it runs inside Shopify Admin, so it
 * can't be a public login).
 */
export const loader = async () => ({ buyerLive: isDemoEnabled() });

export default function DemoHub() {
  const { buyerLive } = useLoaderData<typeof loader>();
  return (
    <>
      <span className="demo-pill">Try before you install</span>
      <h1 className="demo-title">
        See the whole workflow.
        <br />
        <span className="hl">No install, no sign-up.</span>
      </h1>
      <p className="demo-sub">
        Quote, counter with Claude, accept, and reorder. Try the buyer side live on our
        demo store, then walk through the merchant side screen by screen.
      </p>
      <p className="demo-accent">Built on Shopify’s native B2B — every price comes from Shopify.</p>

      <div className="demo-cards">
        <section className="demo-card" aria-labelledby="buyer-demo-h">
          <span className="demo-card-kicker">Live · buyer side</span>
          <h2 id="buyer-demo-h">Open the buyer portal</h2>
          <p>
            You become a sample buyer on our demo store, with a countered quote waiting
            for your approval and a reorder card built from a real order.
          </p>
          <ul>
            <li>Accept a countered quote — it becomes a real Shopify draft order</li>
            <li>Request a new quote from the live catalog</li>
            <li>Paste SKUs into the order pad, or reorder a past order in one tap</li>
            <li>Invoices on net terms, team members, Arabic and RTL</li>
          </ul>
          <div className="demo-card-foot">
            {buyerLive ? (
              <a className="demo-btn" href="/demo/buyer">
                Open the buyer demo
              </a>
            ) : (
              <span className="demo-btn" aria-disabled="true" style={{ opacity: 0.5 }}>
                Buyer demo unavailable
              </span>
            )}
            <span className="demo-note">Sample buyer · nothing is charged</span>
          </div>
        </section>

        <section className="demo-card" aria-labelledby="merchant-tour-h">
          <span className="demo-card-kicker">Guided tour · merchant side</span>
          <h2 id="merchant-tour-h">Walk through the merchant admin</h2>
          <p>
            The merchant app lives inside Shopify Admin. This tour shows the real screens
            with sample data, from the quote inbox to Claude insights.
          </p>
          <ul>
            <li>Quote inbox and a new quote priced by Shopify</li>
            <li>✦ Draft with Claude: counters you review and send</li>
            <li>Net terms, the AI Order Pad, analytics and credit</li>
            <li>Follow-ups, minimums, tax exemption, catalogs, Arabic</li>
          </ul>
          <div className="demo-card-foot">
            <Link className="demo-btn-secondary" to="/demo/tour">
              Start the tour
            </Link>
            <span className="demo-note">11 screens · about 3 minutes</span>
          </div>
        </section>
      </div>
    </>
  );
}
