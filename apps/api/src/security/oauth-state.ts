import { createHash, randomBytes } from "node:crypto";
import type { OauthTransaction, PrismaClient, Provider } from "@mixcraft/database";
import { ApiError } from "../types/api-error.js";
import { decodeEncryptionKey, decryptFromEnvelope, encryptToEnvelope } from "./encryption.js";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** PKCE S256 challenge for a verifier (RFC 7636). */
export function generatePkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface OauthTransactionParams {
  state: string;
  binding: string;
  codeVerifier: string;
  stateHash: string;
  bindingHash: string;
  expiresAt: Date;
}

export function generateOauthTransaction(
  ttlSeconds: number,
  now: Date = new Date(),
): OauthTransactionParams {
  const state = randomBytes(32).toString("base64url");
  const binding = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  return {
    state,
    binding,
    codeVerifier,
    stateHash: sha256Hex(state),
    bindingHash: sha256Hex(binding),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}

export interface PersistedOauthTransaction {
  id: string;
  stateHash: string;
  bindingHash: string;
  codeVerifier: string;
}

export async function persistOauthTransaction(
  db: PrismaClient,
  params: {
    provider: Provider;
    encryptionKey: string;
    transaction: OauthTransactionParams;
  },
): Promise<{ id: string }> {
  const key = decodeEncryptionKey(params.encryptionKey);
  const envelope = encryptToEnvelope(params.transaction.codeVerifier, key);
  return db.oauthTransaction.create({
    data: {
      provider: params.provider,
      stateHash: params.transaction.stateHash,
      browserSessionBinding: params.transaction.bindingHash,
      pkceVerifierCiphertext: new Uint8Array(envelope),
      expiresAt: params.transaction.expiresAt,
    },
    select: { id: true },
  });
}

export interface ConsumedOauthTransaction {
  id: string;
  codeVerifier: string;
  bindingHash: string;
}

function decryptVerifier(
  record: {
    pkceVerifierCiphertext: Uint8Array | Buffer | null;
  },
  encryptionKey: string,
): string {
  const key = decodeEncryptionKey(encryptionKey);
  try {
    if (!record.pkceVerifierCiphertext) {
      throw new Error("missing pkce verifier");
    }
    return decryptFromEnvelope(Buffer.from(record.pkceVerifierCiphertext), key);
  } catch {
    // Key rotation or corrupt ciphertext: the transaction cannot be completed.
    throw new ApiError("VALIDATION_FAILED", "OAuth request could not be verified.");
  }
}

/**
 * Validates state (single-use), browser binding cookie, and expiry, then
 * atomically marks the transaction consumed. Returns the decrypted PKCE verifier.
 */
export async function consumeOauthTransaction(
  db: PrismaClient,
  input: {
    state: string;
    binding: string | undefined;
    encryptionKey: string;
    now?: Date;
  },
): Promise<ConsumedOauthTransaction> {
  const now = input.now ?? new Date();
  if (!input.binding) {
    throw new ApiError("VALIDATION_FAILED", "Missing OAuth session binding.");
  }
  const stateHash = sha256Hex(input.state);
  const record = await db.oauthTransaction.findUnique({ where: { stateHash } });
  if (!record || record.expiresAt.getTime() <= now.getTime()) {
    throw new ApiError("VALIDATION_FAILED", "OAuth request is invalid or has expired.");
  }
  if (!record.browserSessionBinding || sha256Hex(input.binding) !== record.browserSessionBinding) {
    throw new ApiError("PERMISSION_DENIED", "OAuth session binding mismatch.");
  }
  const consumed = await db.oauthTransaction.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    throw new ApiError("OPERATION_CONFLICT", "OAuth request has already been used.");
  }
  return {
    id: record.id,
    codeVerifier: decryptVerifier(record, input.encryptionKey),
    bindingHash: record.browserSessionBinding,
  };
}

/**
 * Binding-first variant for providers whose redirect does not reliably echo
 * `state` (e.g. the GitHub App installation flow). When `state` is supplied it
 * must match the stored hash and the binding is then verified against it
 * (mismatch → PERMISSION_DENIED, matching the state-first path); without
 * `state`, the newest unexpired unconsumed transaction for this browser
 * binding is consumed. Always single-use.
 */
export async function consumeOauthTransactionByBinding(
  db: PrismaClient,
  input: {
    binding: string | undefined;
    state?: string | undefined;
    provider: Provider;
    encryptionKey: string;
    now?: Date;
  },
): Promise<ConsumedOauthTransaction> {
  const now = input.now ?? new Date();
  if (!input.binding) {
    throw new ApiError("VALIDATION_FAILED", "Missing OAuth session binding.");
  }
  const bindingHash = sha256Hex(input.binding);

  let record: OauthTransaction | null;
  if (input.state) {
    record = await db.oauthTransaction.findUnique({
      where: { stateHash: sha256Hex(input.state) },
    });
    if (
      !record ||
      record.provider !== input.provider ||
      record.expiresAt.getTime() <= now.getTime()
    ) {
      throw new ApiError("VALIDATION_FAILED", "OAuth request is invalid or has expired.");
    }
    if (!record.browserSessionBinding || record.browserSessionBinding !== bindingHash) {
      throw new ApiError("PERMISSION_DENIED", "OAuth session binding mismatch.");
    }
  } else {
    record = await db.oauthTransaction.findFirst({
      where: {
        provider: input.provider,
        browserSessionBinding: bindingHash,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!record) {
      throw new ApiError("VALIDATION_FAILED", "OAuth request is invalid or has expired.");
    }
  }

  const consumed = await db.oauthTransaction.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) {
    throw new ApiError("OPERATION_CONFLICT", "OAuth request has already been used.");
  }
  return {
    id: record.id,
    codeVerifier: decryptVerifier(record, input.encryptionKey),
    bindingHash: record.browserSessionBinding ?? bindingHash,
  };
}
