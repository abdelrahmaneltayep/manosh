import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import prisma from "../db.server";
import { requireBuyerId } from "../services/buyer-session.server";
import { getSavedListItems } from "../services/saved-order.server";

// JSON endpoint: a saved list's items (variantId + qty), ownership-scoped to the
// buyer's company. The order pad fetches this to "reorder" a saved list into the
// client cart.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const buyerId = await requireBuyerId(request);
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { companyId: true } });
  if (!buyer) throw redirect("/portal/signin");
  const items = await getSavedListItems(buyer.companyId, params.listId!);
  return Response.json(items);
};
