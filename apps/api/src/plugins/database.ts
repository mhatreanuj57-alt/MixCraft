import { createPrismaClient, type PrismaClient } from "@mixcraft/database";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

export function setupDatabase(app: FastifyInstance): void {
  if (!env.DATABASE_URL) {
    app.decorate("database", { db: null, configured: false });
    app.log.warn("DATABASE_URL is not set; database-backed features are disabled.");
    return;
  }
  const db: PrismaClient = createPrismaClient(env.DATABASE_URL);
  app.decorate("database", { db, configured: true });
  app.addHook("onClose", async () => {
    await db.$disconnect();
  });
}
