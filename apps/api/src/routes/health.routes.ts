import type { ApiSuccessResponse } from "@mixcraft/shared";
import type { FastifyInstance } from "fastify";
import { API_ROUTES } from "../config/constants.js";
import { env } from "../config/env.js";

interface HealthPayload {
  status: "ok";
  service: string;
  environment: string;
  database: "connected" | "unconfigured" | "error";
}

async function checkDatabase(app: FastifyInstance): Promise<HealthPayload["database"]> {
  const { db, configured } = app.database;
  if (!configured || !db) {
    return "unconfigured";
  }
  try {
    await db.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "error";
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(API_ROUTES.health, async (request, reply) => {
    const database = await checkDatabase(app);
    const response: ApiSuccessResponse<HealthPayload> = {
      data: {
        status: "ok",
        service: "mixcraft-api",
        environment: env.NODE_ENV,
        database,
      },
      meta: { requestId: request.id },
    };
    return reply.send(response);
  });
}
