import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { destroyRepSession } from "../services/rep-session.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const cookie = await destroyRepSession(request);
  return redirect("/rep/signin", { headers: { "Set-Cookie": cookie } });
};

export const loader = ({ request }: LoaderFunctionArgs) => action({ request } as ActionFunctionArgs);
