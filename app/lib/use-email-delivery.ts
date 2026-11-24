import { useRouteLoaderData } from "@remix-run/react";

/**
 * Whether Mannon can deliver email, read from the embedded app shell's loader
 * (routes/app.tsx) so every admin page agrees. False when unknown: the safe
 * default is to offer Copy actions rather than promise a send.
 */
export function useEmailDelivery(): boolean {
  const shell = useRouteLoaderData("routes/app") as { emailDelivery?: boolean } | undefined;
  return shell?.emailDelivery === true;
}
