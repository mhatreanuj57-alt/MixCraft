import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, Session, User } from "@mixcraft/database";

const LAST_SEEN_THROTTLE_MS = 60_000;

export function hashSessionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function createSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreatedSession {
  id: string;
  secret: string;
  expiresAt: Date;
}

export async function createSession(
  db: PrismaClient,
  userId: string,
  options: { idleTtlMinutes: number; absoluteTtlMinutes: number; now?: Date },
): Promise<CreatedSession> {
  const now = options.now ?? new Date();
  const secret = createSessionSecret();
  const session = await db.session.create({
    data: {
      userId,
      sessionHash: hashSessionSecret(secret),
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + options.absoluteTtlMinutes * 60_000),
    },
    select: { id: true, expiresAt: true },
  });
  return { id: session.id, secret, expiresAt: session.expiresAt };
}

export interface ResolvedSession {
  session: Session;
  user: User;
}

export async function resolveSession(
  db: PrismaClient,
  secret: string,
  options: { idleTtlMinutes: number; now?: Date },
): Promise<ResolvedSession | null> {
  const now = options.now ?? new Date();
  const session = await db.session.findUnique({
    where: { sessionHash: hashSessionSecret(secret) },
    include: { user: true },
  });
  if (!session) {
    return null;
  }
  if (session.revokedAt !== null) {
    return null;
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  const idleCutoff = now.getTime() - options.idleTtlMinutes * 60_000;
  if (session.lastSeenAt.getTime() <= idleCutoff) {
    // Idle expired: revoke best-effort so the row cannot be replayed later.
    await db.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }
  return { session, user: session.user };
}

export async function revokeSession(
  db: PrismaClient,
  sessionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}
