import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { MAKE_AN_OFFER_ENABLED } from "../services/offers.server";

// The offers list is now the Offers view of the Quotes table
// (/app/quotes?view=offers). This keeps old links and bookmarks working;
// offer detail, rules and widget pages are unchanged.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  if (!MAKE_AN_OFFER_ENABLED()) throw new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  url.searchParams.set("view", "offers");
  throw redirect(`/app/quotes?${url.searchParams.toString()}`);
};
