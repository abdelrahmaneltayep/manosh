import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { commitBuyerSession } from "../services/buyer-session.server";
import { clientIp, startDemo } from "../services/demo.server";
import { captureException } from "../lib/sentry.server";

/**
 * Public "Try the demo" entry (linked from the landing page). Provisions a
 * throwaway buyer on the merchant-designated demo store and drops the visitor
 * into the buyer portal — the same portal a real buyer sees after a magic link.
 * Every failure mode renders a plain-language page; nothing here can 500.
 */

type Notice = { title: string; body: string };

const NOTICES: Record<string, Notice> = {
  disabled: {
    title: "The demo isn’t available right now",
    body: "Install Mannon on your own store to try it — it takes a minute and there’s a free plan.",
  },
  "not-installed": {
    title: "The demo store is being set up",
    body: "Mannon isn’t installed on the demo store yet. Please check back shortly.",
  },
  "no-company": {
    title: "The demo store has no B2B company yet",
    body: "Mannon rides Shopify’s native B2B, so the demo needs at least one company on the demo store. Please check back shortly.",
  },
  "rate-limited": {
    title: "Too many demo sessions from your network",
    body: "You can open a few demo sessions per hour. Please try again a little later.",
  },
  error: {
    title: "Something went wrong opening the demo",
    body: "Please try again in a moment. If it keeps happening, install Mannon on your own store instead.",
  },
};

export const meta: MetaFunction = () => [{ title: "Try the Mannon demo" }];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
});

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

export default function Demo() {
  const { notice } = useLoaderData<typeof loader>();
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem 1rem",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        background: "#f6f5ff",
        color: "#1c1d2b",
      }}
    >
      <section
        role="status"
        aria-live="polite"
        style={{
          maxWidth: "32rem",
          background: "#fff",
          borderRadius: "1rem",
          padding: "2rem",
          boxShadow: "0 12px 40px rgba(28, 29, 43, 0.08)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{notice.title}</h1>
        <p style={{ color: "#5b5f6e", lineHeight: 1.55 }}>{notice.body}</p>
        <p style={{ marginBottom: 0 }}>
          <Link to="/" style={{ color: "#4f46e5", fontWeight: 700 }}>
            ← Back to Mannon
          </Link>
        </p>
      </section>
    </main>
  );
}
