import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shopify webhook HMAC verification (guardrail #3). Every webhook route calls
 * `verifyWebhook` and rejects a bad/missing signature with 401 BEFORE running
 * any handler logic. Reviewers exercise this on every submission.
 */

export function computeHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export function isValidHmac(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const expected = computeHmac(rawBody, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface WebhookVerification {
  ok: boolean;
  rawBody: string;
  shopDomain: string | null;
  topic: string | null;
}

/**
 * Read the raw request body and verify its HMAC. Returns the raw body so the
 * caller can JSON.parse it only after `ok` is confirmed.
 */
export async function verifyWebhook(
  request: Request,
  secret: string,
): Promise<WebhookVerification> {
  const rawBody = await request.text();
  const ok = isValidHmac(
    rawBody,
    request.headers.get("X-Shopify-Hmac-Sha256"),
    secret,
  );
  return {
    ok,
    rawBody,
    shopDomain: request.headers.get("X-Shopify-Shop-Domain"),
    topic: request.headers.get("X-Shopify-Topic"),
  };
}
