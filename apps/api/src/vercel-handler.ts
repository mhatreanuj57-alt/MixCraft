import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "./app.js";

const app = buildApp();
await app.ready();

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  app.server.emit("request", request, response);
}
