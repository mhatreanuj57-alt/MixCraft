import { z } from "zod";
import { PROVIDER_IDS } from "../types/providers.js";
import type { ConnectionSummary, ProviderId } from "../types/providers.js";

export const connectionProviderSchema = z.enum(PROVIDER_IDS);

export const connectionParamsSchema = z.object({
  provider: connectionProviderSchema,
  connectionId: z.string().uuid(),
});

export const connectNpmSchema = z.object({
  token: z.string().trim().min(1).max(4096),
});

export const githubConnectionCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  installation_id: z.string().regex(/^\d+$/).optional(),
  setup_action: z.enum(["install", "update", "request"]).optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().optional(),
});

export const vercelConnectionCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().optional(),
});

export const ConnectionRecordSchema = z.object({
  id: z.string().uuid(),
  provider: connectionProviderSchema,
  status: z.enum(["connected", "disconnected", "pending", "expired"]),
  accountName: z.string().nullable(),
  lastValidatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const connectionRefreshSchema = z.object({
  connection: ConnectionRecordSchema,
});

export const disconnectSchema = z.object({
  disconnected: z.literal(true),
});

export const connectionRedirectQuerySchema = z.object({
  provider: connectionProviderSchema.optional(),
  status: z.enum(["connected"]).optional(),
  error: z.string().min(1).optional(),
});

export interface ConnectionRecord extends ConnectionSummary {
  id: string;
  createdAt: string;
}

export interface ConnectionsListPayload {
  connections: ConnectionRecord[];
  configured: Record<ProviderId, boolean>;
}

export type ConnectionParams = z.infer<typeof connectionParamsSchema>;
export type ConnectNpmPayload = z.infer<typeof connectNpmSchema>;
export type GithubConnectionCallbackQuery = z.infer<typeof githubConnectionCallbackQuerySchema>;
export type VercelConnectionCallbackQuery = z.infer<typeof vercelConnectionCallbackQuerySchema>;
export type ConnectionRefreshPayload = z.infer<typeof connectionRefreshSchema>;
export type DisconnectPayload = z.infer<typeof disconnectSchema>;
export type ConnectionRedirectQuery = z.infer<typeof connectionRedirectQuerySchema>;
