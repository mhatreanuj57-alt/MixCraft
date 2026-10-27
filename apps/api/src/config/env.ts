import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function isValidEncryptionKey(value: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex").length === 32;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return false;
  }
  return Buffer.from(value, "base64").length === 32;
}

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    VERCEL_ENV: z.preprocess(
      emptyToUndefined,
      z.enum(["development", "preview", "production"]).optional(),
    ),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    WEB_ORIGIN: z.preprocess(emptyToUndefined, z.string().url().optional()),
    API_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    DATABASE_URL: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    // GitHub App used for provider connections (distinct from the login OAuth app).
    GITHUB_APP_ID: optionalString,
    GITHUB_APP_SLUG: optionalString,
    GITHUB_APP_CLIENT_ID: optionalString,
    GITHUB_APP_CLIENT_SECRET: optionalString,
    GITHUB_APP_PRIVATE_KEY: optionalString,
    VERCEL_CLIENT_ID: optionalString,
    VERCEL_CLIENT_SECRET: optionalString,
    ENCRYPTION_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine(isValidEncryptionKey, {
          message: "ENCRYPTION_KEY must be the base64 or hex encoding of exactly 32 bytes",
        })
        .optional(),
    ),
    SESSION_IDLE_TTL_MINUTES: z.coerce.number().int().positive().default(720),
    SESSION_ABSOLUTE_TTL_MINUTES: z.coerce.number().int().positive().default(10080),
    OAUTH_TRANSACTION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  })
  .superRefine((value, ctx) => {
    if (value.SESSION_ABSOLUTE_TTL_MINUTES < value.SESSION_IDLE_TTL_MINUTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_ABSOLUTE_TTL_MINUTES"],
        message: "SESSION_ABSOLUTE_TTL_MINUTES must be >= SESSION_IDLE_TTL_MINUTES",
      });
    }
    if (value.NODE_ENV !== "production") {
      return;
    }
    const previewRequiredFields = [
      "DATABASE_URL",
      "WEB_ORIGIN",
      "ENCRYPTION_KEY",
      "API_BASE_URL",
    ] as const;
    // Login is required in production. Connection providers are optional and
    // reported as PROVIDER_UNAVAILABLE by loadConnectionsConfig when unset.
    const productionRequiredFields = [
      ...previewRequiredFields,
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ] as const;
    const requiredFields =
      value.VERCEL_ENV === "preview" ? previewRequiredFields : productionRequiredFields;
    for (const field of requiredFields) {
      if (value[field] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when NODE_ENV=production`,
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    WEB_ORIGIN: value.WEB_ORIGIN ?? "http://localhost:5173",
    API_BASE_URL: value.API_BASE_URL ?? "http://127.0.0.1:3001",
  }));

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();
