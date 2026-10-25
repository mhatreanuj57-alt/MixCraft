import type { PrismaClient, Session, User } from "@mixcraft/database";

export interface AuthContext {
  session: Session;
  user: User;
}

declare module "fastify" {
  interface FastifyInstance {
    database: { db: PrismaClient | null; configured: boolean };
  }

  interface FastifyRequest {
    auth: AuthContext | null;
    /** True when a session cookie was present but could not be verified (DB down). */
    authUnavailable: boolean;
  }

  interface FastifyContextConfig {
    /** Opt out of the CSRF double-submit check (e.g. signature-verified webhooks). */
    skipCsrf?: boolean;
  }
}
