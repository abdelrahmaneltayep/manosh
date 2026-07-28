import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * F10 — AES-256-GCM encryption for secrets we must store (external accounting
 * OAuth tokens). Tokens live encrypted at rest (AccountingConnection) and are
 * only ever decrypted in transit to the provider — never logged (guardrail #7).
 *
 * The key comes from `MANNON_ENCRYPTION_KEY`: a 32-byte key, hex or base64. Any
 * other length is hashed to 32 bytes with SHA-256 so a passphrase also works. In
 * production the app should be given a real 32-byte random key.
 *
 * Wire format (single string, safe to store in a TEXT column):
 *   v1.<iv-base64>.<authTag-base64>.<ciphertext-base64>
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

/** Resolve the 32-byte key from the env, hashing anything that isn't exactly 32 bytes. */
export function resolveKey(raw = process.env.MANNON_ENCRYPTION_KEY): Buffer {
  if (!raw) {
    throw new Error(
      "MANNON_ENCRYPTION_KEY is not set — accounting token storage is disabled until it is.",
    );
  }
  // Try hex, then base64; fall back to hashing (covers passphrases).
  for (const enc of ["hex", "base64"] as const) {
    try {
      const buf = Buffer.from(raw, enc);
      if (buf.length === 32) return buf;
    } catch {
      /* try next encoding */
    }
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

/** Encrypt a UTF-8 secret. Returns the versioned wire string. */
export function encryptSecret(plaintext: string, key = resolveKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/** Decrypt a wire string produced by {@link encryptSecret}. Throws if tampered. */
export function decryptSecret(payload: string, key = resolveKey()): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed ciphertext");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when an encryption key is configured (accounting token storage usable). */
export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.MANNON_ENCRYPTION_KEY);
}
