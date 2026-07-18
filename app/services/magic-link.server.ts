import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Buyer, Company } from "@prisma/client";
import prisma from "../db.server";

/**
 * Passwordless buyer auth (S4). A merchant issues a signed, expiring link for a
 * buyer email; the buyer opens it and lands authenticated on the non-embedded
 * /portal.
 *
 * Guardrail #7: we store ONLY the hash of the token (`magicTokenHash`). The raw
 * token exists only inside the emailed URL. Tokens are single-use: consuming
 * one is an atomic conditional update, so a replay (or a link scanner's second
 * request) is rejected.
 */

const TOKEN_BYTES = 32; // 256-bit token
const DEFAULT_EXPIRY_DAYS = 7; // fallback if a shop has no setting (it always should)

export type BuyerWithCompany = Buyer & { company: Company };

/** SHA-256 hex of the raw token. Deterministic, one-way. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Generate a fresh opaque token and its at-rest hash. */
export function generateMagicToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

/**
 * Issue a magic link for a buyer: store the token hash + expiry (from the
 * shop's `magicLinkExpiryDays` setting) and return the absolute URL to email.
 * The raw token is returned ONLY inside that URL and never persisted.
 */
export async function issueMagicLink(
  buyerId: string,
  options: { baseUrl: string; now?: Date },
): Promise<{ url: string; expiresAt: Date }> {
  const now = options.now ?? new Date();
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { company: { include: { shop: true } } },
  });
  if (!buyer) {
    throw new Error(`Buyer ${buyerId} not found`);
  }

  const expiryDays = buyer.company.shop.magicLinkExpiryDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  const { raw, hash } = generateMagicToken();

  await prisma.buyer.update({
    where: { id: buyer.id },
    data: { magicTokenHash: hash, magicTokenExpiresAt: expiresAt },
  });

  const url = new URL("/portal/auth", options.baseUrl);
  url.searchParams.set("token", raw);

  return { url: url.toString(), expiresAt };
}

export type VerifyFailure = "invalid" | "expired";
export type VerifyResult =
  | { ok: true; buyer: BuyerWithCompany }
  | { ok: false; reason: VerifyFailure };

/**
 * Verify a raw token. With `{ consume: true }` the token is atomically
 * invalidated (single-use); concurrent/replayed consumes lose the race and are
 * rejected as "invalid". With `{ consume: false }` (default) it only peeks —
 * used by the GET landing so an email link-scanner can't burn the token.
 */
export async function verifyMagicToken(
  rawToken: string | null | undefined,
  options: { consume?: boolean; now?: Date } = {},
): Promise<VerifyResult> {
  if (!rawToken) return { ok: false, reason: "invalid" };
  const now = options.now ?? new Date();
  const hash = hashToken(rawToken);

  const buyer = await prisma.buyer.findFirst({
    where: { magicTokenHash: hash },
    include: { company: true },
  });
  if (!buyer || !buyer.magicTokenHash || !buyer.magicTokenExpiresAt) {
    return { ok: false, reason: "invalid" };
  }
  // Defense in depth: constant-time compare the stored hash even though the
  // lookup already matched on it.
  if (!safeEqualHex(buyer.magicTokenHash, hash)) {
    return { ok: false, reason: "invalid" };
  }
  if (buyer.magicTokenExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  if (options.consume) {
    const consumed = await prisma.buyer.updateMany({
      where: {
        id: buyer.id,
        magicTokenHash: hash,
        magicTokenExpiresAt: { gt: now },
      },
      data: { magicTokenHash: null, magicTokenExpiresAt: null },
    });
    if (consumed.count !== 1) {
      // Lost the race — already consumed elsewhere.
      return { ok: false, reason: "invalid" };
    }
  }

  return { ok: true, buyer };
}

/** Revoke any outstanding magic link for a buyer. */
export async function revokeMagicLink(buyerId: string): Promise<void> {
  await prisma.buyer.update({
    where: { id: buyerId },
    data: { magicTokenHash: null, magicTokenExpiresAt: null },
  });
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
