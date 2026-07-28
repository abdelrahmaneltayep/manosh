import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import prisma from "../db.server";
import { getBuyerId } from "../services/buyer-session.server";
import { localeCookie, setLocalePreference, resolveBuyerContext } from "../services/i18n.server";
import { isSupportedLocale } from "../lib/i18n";

/**
 * F16 — buyer locale/currency switch. Sets the session locale cookie (so the
 * portal shell mirrors RTL immediately) and, for a signed-in buyer, persists the
 * preference (member-level) so it follows them + localizes their emails.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  const redirectTo = String(form.get("redirectTo") ?? "/portal");
  if (!isSupportedLocale(locale)) return redirect(redirectTo);

  // Persist for a signed-in buyer (member preference).
  const buyerId = await getBuyerId(request);
  if (buyerId) {
    const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { company: { include: { shop: true } } } });
    if (buyer) {
      const ctx = await resolveBuyerContext(buyer.company.shop.shopifyDomain, { companyId: buyer.companyId, memberId: buyer.id, cookieLocale: locale });
      const currency = String(form.get("currency") ?? ctx.currency);
      await setLocalePreference({ memberId: buyer.id }, locale, currency);
    }
  }

  return redirect(redirectTo, { headers: { "Set-Cookie": await localeCookie.serialize(locale) } });
};

export const loader = () => redirect("/portal");
