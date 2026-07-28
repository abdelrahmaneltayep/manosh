import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, resolveKey } from "./crypto.server";

// A fixed 32-byte key so the tests don't depend on the env.
const KEY = resolveKey("0123456789abcdef0123456789abcdef");

describe("crypto.server (token encryption at rest)", () => {
  it("round-trips a secret", () => {
    const token = "qbo-refresh-token-abc.123-XYZ";
    const enc = encryptSecret(token, KEY);
    expect(enc).not.toContain(token); // ciphertext must not leak the plaintext
    expect(decryptSecret(enc, KEY)).toBe(token);
  });

  it("produces a fresh IV each time (ciphertexts differ, both decrypt)", () => {
    const a = encryptSecret("same", KEY);
    const b = encryptSecret("same", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe("same");
    expect(decryptSecret(b, KEY)).toBe("same");
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const enc = encryptSecret("secret", KEY);
    const parts = enc.split(".");
    // flip a char in the ciphertext segment
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload", KEY)).toThrow("Malformed ciphertext");
  });

  it("derives a 32-byte key from a passphrase", () => {
    expect(resolveKey("a short passphrase").length).toBe(32);
    expect(resolveKey("0123456789abcdef0123456789abcdef").length).toBe(32); // hex → 32 bytes
  });
});
