import type { ProviderId } from "../types/providers.js";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
}

export const PROVIDER_META: readonly ProviderMeta[] = [
  { id: "github", label: "GitHub" },
  { id: "npm", label: "npm" },
  { id: "vercel", label: "Vercel" },
];
