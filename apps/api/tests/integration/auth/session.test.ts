import { createPrismaClient, type PrismaClient, type User } from "@mixcraft/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../../src/config/env.js";
import {
  createSession,
  createSessionSecret,
  hashSessionSecret,
  resolveSession,
  revokeSession,
} from "../../../src/modules/auth/session.service.js";

const githubUserId = String(9_100_000_000 + Math.floor(Math.random() * 1_000_000));

let db: PrismaClient;
let user: User;

beforeAll(async () => {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for integration tests (see vitest.config.ts)");
  }
  db = createPrismaClient(env.DATABASE_URL);
  user = await db.user.create({
    data: { githubUserId, githubLogin: `session-test-${githubUserId.slice(-6)}` },
  });
});

afterAll(async () => {
  await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
});

describe("session lifecycle", () => {
  it("creates a session that resolves together with its user", async () => {
    const created = await createSession(db, user.id, {
      idleTtlMinutes: 720,
      absoluteTtlMinutes: 10080,
    });
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const resolved = await resolveSession(db, created.secret, { idleTtlMinutes: 720 });
    expect(resolved?.session.id).toBe(created.id);
    expect(resolved?.user.id).toBe(user.id);
  });

  it("rejects an absolutely expired session", async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
    const created = await createSession(db, user.id, {
      idleTtlMinutes: 720,
      absoluteTtlMinutes: 1440, // 24h absolute TTL, created 48h ago
      now: twoDaysAgo,
    });
    expect(await resolveSession(db, created.secret, { idleTtlMinutes: 720 })).toBeNull();
  });

  it("rejects and revokes an idle-expired session", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    const created = await createSession(db, user.id, {
      idleTtlMinutes: 60,
      absoluteTtlMinutes: 10080,
      now: threeHoursAgo,
    });
    expect(await resolveSession(db, created.secret, { idleTtlMinutes: 60 })).toBeNull();

    const row = await db.session.findUnique({ where: { id: created.id } });
    expect(row?.revokedAt).not.toBeNull();
  });

  it("rejects a revoked session", async () => {
    const created = await createSession(db, user.id, {
      idleTtlMinutes: 720,
      absoluteTtlMinutes: 10080,
    });
    await revokeSession(db, created.id);
    expect(await resolveSession(db, created.secret, { idleTtlMinutes: 720 })).toBeNull();
  });

  it("rejects an unknown secret", async () => {
    expect(await resolveSession(db, "not-a-real-secret", { idleTtlMinutes: 720 })).toBeNull();
  });

  it("hashes session secrets with sha256 and generates unique secrets", () => {
    const secret = createSessionSecret();
    const other = createSessionSecret();
    expect(secret).not.toBe(other);
    expect(hashSessionSecret(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionSecret(secret)).toBe(hashSessionSecret(secret));
  });
});
