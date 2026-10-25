export const PROVIDER_IDS = ["github", "npm", "vercel"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ConnectionStatus = "connected" | "disconnected" | "pending" | "expired";

export interface ConnectionSummary {
  provider: ProviderId;
  status: ConnectionStatus;
  accountName: string | null;
  lastValidatedAt: string | null;
}
