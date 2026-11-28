import { merchantAlertAddresses } from "./merchant-alerts.server";
import { shopNameFor } from "./shop-name.server";

/**
 * Sender details for every email a buyer (or a store's rep or applicant)
 * receives: the store's name as the sender name, and the store's own address
 * as Reply-To, so a buyer who hits Reply reaches the store, never Mannon.
 * The address is the store's first alert address (Settings › Notifications),
 * which is filled from the store's contact email in Shopify. Only a store with
 * no address at all falls back to the sending address.
 */
export async function storeSender(shopDomain: string): Promise<{ fromName: string; replyTo?: string }> {
  const [fromName, addresses] = await Promise.all([shopNameFor(shopDomain), merchantAlertAddresses(shopDomain).catch(() => [])]);
  return addresses[0] ? { fromName, replyTo: addresses[0] } : { fromName };
}
