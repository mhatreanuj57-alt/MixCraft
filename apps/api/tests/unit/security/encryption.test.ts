import { describe, expect, it } from "vitest";
import {
  decodeEncryptionKey,
  decryptFromEnvelope,
  decryptSecret,
  encryptSecret,
  encryptToEnvelope,
} from "../../../src/security/encryption.js";

const KEY = Buffer.alloc(32, 9);
const OTHER_KEY = Buffer.alloc(32, 7);

describe("encryption", () => {
  it("decodes a base64 key to 32 bytes", () => {
    const decoded = decodeEncryptionKey(KEY.toString("base64"));
    expect(decoded.length).toBe(32);
    expect(decoded.equals(KEY)).toBe(true);
  });

  it("decodes a hex key to 32 bytes", () => {
    const decoded = decodeEncryptionKey(KEY.toString("hex"));
    expect(decoded.equals(KEY)).toBe(true);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => decodeEncryptionKey("dG9vLXNob3J0")).toThrow(/32 bytes/);
    expect(() => decodeEncryptionKey("")).toThrow(/32 bytes/);
  });

  it("round-trips a secret", () => {
    const payload = encryptSecret("super-secret-value", KEY);
    expect(payload.nonce.length).toBe(12);
    expect(payload.authenticationTag.length).toBe(16);
    expect(payload.ciphertext.equals(Buffer.from("super-secret-value"))).toBe(false);
    expect(decryptSecret(payload, KEY)).toBe("super-secret-value");
  });

  it("fails to decrypt with the wrong key", () => {
    const payload = encryptSecret("super-secret-value", KEY);
    expect(() => decryptSecret(payload, OTHER_KEY)).toThrow();
  });

  it("uses a fresh nonce for every encryption", () => {
    const a = encryptSecret("same-input", KEY);
    const b = encryptSecret("same-input", KEY);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("round-trips the single-column envelope format", () => {
    const envelope = encryptToEnvelope("pkce-verifier", KEY);
    expect(decryptFromEnvelope(envelope, KEY)).toBe("pkce-verifier");
  });

  it("rejects envelopes that are too short", () => {
    expect(() => decryptFromEnvelope(Buffer.from("short"), KEY)).toThrow(/too short/);
  });
});
