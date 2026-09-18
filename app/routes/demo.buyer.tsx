import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { commitBuyerSession } from "../services/buyer-session.server";
import { clientIp, startDemo } from "../services/demo.server";
import { captureException } from "../lib/sentry.server";

/**
 * Live buyer demo entry. Provisions a throwaway buyer on the demo store (with
 * sample quotes and reorder cards) and drops the visitor into the buyer portal —
 * the same portal a real buyer sees after a magic link. Every failure mode
 * renders a plain-language notice inside the demo shell; nothing here can 500.
 */

type Notice = { title: string; body: string };

const NOTICES: Record<string, Notice> = {
  disabled: {
    title: "The buyer demo isn’t available right now",
    body: "Take the merchant tour instead, or install Mannon on your own store — it takes a minute and there’s a free plan.",
  },
  "not-installed": {
    title: "The demo store is being set up",
    body: "Mannon isn’t installed on the demo store yet. Please check back shortly, or take the merchant tour.",
  },
  "no-company": {
    title: "The demo store has no B2B company yet",
    body: "Mannon rides Shopify’s native B2B, so the demo needs at least one company on the demo store. Please check back shortly.",
  },
  "rate-limited": {
    title: "Too many demo sessions from your network",
    body: "You can open a few demo sessions per hour. Please try again a little later, or take the merchant tour meanwhile.",
  },
  error: {
    title: "Something went wrong opening the demo",
    body: "Please try again in a moment. If it keeps happening, install Mannon on your own store instead.",
  },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const result = await startDemo({ ip: clientIp(request) });
    if (result.ok) {
      const cookie = await commitBuyerSession(result.buyerId);
      return redirect("/portal", { headers: { "Set-Cookie": cookie } });
    }
    return { notice: NOTICES[result.reason] };
  } catch (error) {
    captureException(error);
    return { notice: NOTICES.error };
  }
};

export default function DemoBuyer() {
  const { notice } = useLoaderData<typeof loader>();
  return (
    <section className="demo-notice" role="status" aria-live="polite">
      <h1>{notice.title}</h1>
      <p>{notice.body}</p>
      <div className="demo-card-foot">
        <Link className="demo-btn" to="/demo/tour">
          Take the merchant tour
        </Link>
        <Link className="demo-btn-secondary" to="/demo">
          Back to the demo
        </Link>
      </div>
    </section>
  );
}
