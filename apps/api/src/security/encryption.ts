import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;

export const CURRENT_KEY_VERSION = 1;

export interface EncryptedPayload {
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
}

export function decodeEncryptionKey(key: string): Buffer {
  const decoded = /^[0-9a-fA-F]{64}$/.test(key)
    ? Buffer.from(key, "hex")
    : Buffer.from(key, "base64");
  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new Error("Encryption key must decode to exactly 32 bytes");
  }
  return decoded;
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedPayload {
  const nonce = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext,
    nonce,
    authenticationTag: cipher.getAuthTag(),
  };
}

export function decryptSecret(payload: EncryptedPayload, key: Buffer): string {
  if (payload.authenticationTag.length !== TAG_LENGTH_BYTES) {
    throw new Error("Invalid authentication tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, key, payload.nonce);
  decipher.setAuthTag(payload.authenticationTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Single-column envelope used where the schema stores one blob
 * (e.g. oauth_transactions.pkce_verifier_ciphertext): nonce || tag || ciphertext.
 */
export function encryptToEnvelope(plaintext: string, key: Buffer): Buffer {
  const payload = encryptSecret(plaintext, key);
  return Buffer.concat([payload.nonce, payload.authenticationTag, payload.ciphertext]);
}

export function decryptFromEnvelope(envelope: Buffer, key: Buffer): string {
  const minimumLength = IV_LENGTH_BYTES + TAG_LENGTH_BYTES;
  if (envelope.length <= minimumLength) {
    throw new Error("Encrypted envelope is too short");
  }
  return decryptSecret(
    {
      nonce: envelope.subarray(0, IV_LENGTH_BYTES),
      authenticationTag: envelope.subarray(IV_LENGTH_BYTES, minimumLength),
      ciphertext: envelope.subarray(minimumLength),
    },
    key,
  );
}
