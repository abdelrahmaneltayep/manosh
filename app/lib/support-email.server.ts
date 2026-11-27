import { DEFAULT_SUPPORT_EMAIL } from "./legal";

/**
 * The support address to show, from MANNON_SUPPORT_EMAIL when it is set to a
 * valid address, else the default in legal.ts. Server-only: pages get it from
 * their loader so server and browser render the same text.
 */
export function supportEmail(env: Record<string, string | undefined> = process.env): string {
  const configured = env.MANNON_SUPPORT_EMAIL?.trim();
  return configured && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configured) ? configured : DEFAULT_SUPPORT_EMAIL;
}
