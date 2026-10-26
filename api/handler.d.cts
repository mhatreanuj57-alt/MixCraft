import type { IncomingMessage, ServerResponse } from "node:http";

declare function handler(request: IncomingMessage, response: ServerResponse): Promise<void>;

export = handler;
