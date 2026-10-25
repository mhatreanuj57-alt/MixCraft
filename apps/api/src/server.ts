import "./config/load-dotenv.js";
import { buildApp } from "./app.js";
import { APP_NAME } from "./config/constants.js";
import { env } from "./config/env.js";

const app = buildApp();

function shutdown(signal: string): void {
  app.log.info({ signal }, "shutting down");
  void app.close().then(() => process.exit(0));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

app
  .listen({ port: env.API_PORT, host: env.API_HOST })
  .then(() => {
    app.log.info({ app: APP_NAME, port: env.API_PORT, host: env.API_HOST }, "server listening");
  })
  .catch((error: unknown) => {
    app.log.error(error, "failed to start server");
    process.exit(1);
  });
