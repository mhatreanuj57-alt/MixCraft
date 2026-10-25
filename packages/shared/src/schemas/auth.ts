import { z } from "zod";

export const githubCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().optional(),
});

export const meSchema = z.object({
  id: z.string().uuid(),
  githubLogin: z.string().min(1),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
});

export const logoutSchema = z.object({
  loggedOut: z.literal(true),
});

export type GithubCallbackQuery = z.infer<typeof githubCallbackQuerySchema>;
export type MePayload = z.infer<typeof meSchema>;
export type LogoutPayload = z.infer<typeof logoutSchema>;
