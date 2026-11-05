import type { LoginError } from "@shopify/shopify-app-remix/server";
import { LoginErrorType } from "@shopify/shopify-app-remix/server";

interface LoginErrorMessage {
  shop?: string;
}

/**
 * Plain copy for a login hand-off that reached us without a usable shop. Mannon
 * never asks the merchant to type a shop domain (App Store 2.3.1), so a missing
 * shop is not an error to show; an invalid one means the link was wrong.
 */
export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "That link didn’t include a valid Shopify store. Open Mannon from your Shopify admin instead." };
  }
  return {};
}
