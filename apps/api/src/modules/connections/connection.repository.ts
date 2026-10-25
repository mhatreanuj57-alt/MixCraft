import type {
  GithubInstallation,
  PrismaClient,
  Provider,
  ProviderConnection,
} from "@mixcraft/database";
import { Prisma } from "@mixcraft/database";
import { ApiError } from "../../types/api-error.js";

export interface CredentialEnvelope {
  credentialKind: string;
  ciphertext: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  authenticationTag: Uint8Array<ArrayBuffer>;
  expiresAt: Date | null;
}

export interface ConnectionUpsertInput {
  userId: string;
  provider: Provider;
  providerAccountId: string;
  providerAccountName: string;
  scopes: string[];
  lastValidatedAt: Date;
  credential: CredentialEnvelope;
}

export function listUserConnections(
  db: PrismaClient,
  userId: string,
): Promise<ProviderConnection[]> {
  return db.providerConnection.findMany({
    where: { userId },
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
  });
}

export function findOwnedConnection(
  db: PrismaClient,
  input: { userId: string; provider: Provider; connectionId: string },
): Promise<ProviderConnection | null> {
  return db.providerConnection.findFirst({
    where: { id: input.connectionId, userId: input.userId, provider: input.provider },
  });
}

/**
 * Upserts the connection and its single encrypted credential atomically.
 * Callers must have already resolved conflicts that depend on cross-row state
 * (e.g. a GitHub installation owned by another user).
 */
export async function upsertConnectionWithCredential(
  db: PrismaClient,
  input: ConnectionUpsertInput,
): Promise<ProviderConnection> {
  return db.$transaction(async (tx) => {
    const connection = await tx.providerConnection.upsert({
      where: {
        userId_provider_providerAccountId: {
          userId: input.userId,
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      update: {
        providerAccountName: input.providerAccountName,
        status: "connected",
        scopes: input.scopes,
        lastValidatedAt: input.lastValidatedAt,
        disconnectedAt: null,
      },
      create: {
        userId: input.userId,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        providerAccountName: input.providerAccountName,
        status: "connected",
        scopes: input.scopes,
        lastValidatedAt: input.lastValidatedAt,
      },
    });
    await tx.encryptedCredential.upsert({
      where: { connectionId: connection.id },
      update: {
        credentialKind: input.credential.credentialKind,
        ciphertext: input.credential.ciphertext,
        nonce: input.credential.nonce,
        authenticationTag: input.credential.authenticationTag,
        expiresAt: input.credential.expiresAt,
      },
      create: {
        connectionId: connection.id,
        credentialKind: input.credential.credentialKind,
        ciphertext: input.credential.ciphertext,
        nonce: input.credential.nonce,
        authenticationTag: input.credential.authenticationTag,
        expiresAt: input.credential.expiresAt,
      },
    });
    return connection;
  });
}

/** Replaces the stored credential payload in place (e.g. rotating refresh tokens). */
export async function replaceCredential(
  db: PrismaClient,
  connectionId: string,
  credential: CredentialEnvelope,
): Promise<void> {
  await db.encryptedCredential.update({
    where: { connectionId },
    data: {
      credentialKind: credential.credentialKind,
      ciphertext: credential.ciphertext,
      nonce: credential.nonce,
      authenticationTag: credential.authenticationTag,
      expiresAt: credential.expiresAt,
    },
  });
}

export async function markConnectionValidated(
  db: PrismaClient,
  input: {
    connectionId: string;
    now: Date;
    scopes?: string[];
    accountName?: string;
  },
): Promise<ProviderConnection> {
  return db.providerConnection.update({
    where: { id: input.connectionId },
    data: {
      status: "connected",
      lastValidatedAt: input.now,
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...(input.accountName ? { providerAccountName: input.accountName } : {}),
    },
  });
}

export async function markConnectionExpired(
  db: PrismaClient,
  connectionId: string,
  now: Date,
): Promise<ProviderConnection> {
  return db.providerConnection.update({
    where: { id: connectionId },
    data: { status: "expired", updatedAt: now },
  });
}

export function deleteConnection(
  db: PrismaClient,
  connectionId: string,
): Promise<ProviderConnection> {
  return db.providerConnection.delete({ where: { id: connectionId } });
}

export function findGithubInstallationByInstallationId(
  db: PrismaClient,
  installationId: bigint,
): Promise<(GithubInstallation & { connection: { id: string; userId: string } }) | null> {
  return db.githubInstallation.findUnique({
    where: { installationId },
    include: { connection: { select: { id: true, userId: true } } },
  });
}

/**
 * Links a GitHub installation (globally unique across users) to a connection.
 * An installation already owned by a different user's connection is a conflict
 * (`OPERATION_CONFLICT`), including under concurrent connects.
 */
export async function upsertGithubInstallation(
  db: PrismaClient,
  input: {
    connectionId: string;
    installationId: bigint;
    accountLogin: string;
    accountType: string;
  },
): Promise<void> {
  const data = {
    accountLogin: input.accountLogin,
    accountType: input.accountType,
    suspendedAt: null,
  };
  try {
    const updated = await db.githubInstallation.updateMany({
      where: { installationId: input.installationId, connectionId: input.connectionId },
      data,
    });
    if (updated.count === 0) {
      const existing = await db.githubInstallation.findUnique({
        where: { installationId: input.installationId },
      });
      if (existing) {
        throw new ApiError(
          "OPERATION_CONFLICT",
          "That GitHub App installation is connected by another account.",
        );
      }
      await db.githubInstallation.create({
        data: { connectionId: input.connectionId, installationId: input.installationId, ...data },
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(
        "OPERATION_CONFLICT",
        "That GitHub App installation is connected by another account.",
      );
    }
    throw error;
  }
}

export function findGithubInstallationForConnection(
  db: PrismaClient,
  connectionId: string,
): Promise<GithubInstallation | null> {
  return db.githubInstallation.findFirst({ where: { connectionId } });
}

export async function findCredential(
  db: PrismaClient,
  connectionId: string,
): Promise<
  | {
      found: true;
      kind: string;
      ciphertext: Uint8Array;
      nonce: Uint8Array;
      authenticationTag: Uint8Array;
      expiresAt: Date | null;
    }
  | { found: false }
> {
  const row = await db.encryptedCredential.findUnique({ where: { connectionId } });
  if (!row) {
    return { found: false };
  }
  return {
    found: true,
    kind: row.credentialKind,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authenticationTag: row.authenticationTag,
    expiresAt: row.expiresAt,
  };
}
