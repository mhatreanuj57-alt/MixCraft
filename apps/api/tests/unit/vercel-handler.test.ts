import { createRequire } from "node:module";
import { createServer, type RequestListener } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";

describe("Vercel function handler", () => {
  let server: Server;

  beforeAll(async () => {
    process.env.DATABASE_URL = "";
    const require = createRequire(import.meta.url);
    const handler = require("../../../../api/handler.cjs") as RequestListener;
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("forwards API requests to the existing Fastify routes", async () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not start");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const body = (await response.json()) as {
      data: { service: string; database: string };
    };

    expect(response.status).toBe(200);
    expect(body.data.service).toBe("mixcraft-api");
    expect(body.data.database).toBe("unconfigured");

    const secondResponse = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    expect(secondResponse.status).toBe(200);
  });
});
