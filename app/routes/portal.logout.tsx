import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { destroyBuyerSession } from "../services/buyer-session.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const cookie = await destroyBuyerSession(request);
  return redirect("/portal/signin", { headers: { "Set-Cookie": cookie } });
};

// Visiting /portal/logout directly just bounces home.
export const loader = async (_args: LoaderFunctionArgs) => redirect("/portal");
