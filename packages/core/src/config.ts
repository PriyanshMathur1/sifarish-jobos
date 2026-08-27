import { z } from "zod";

/**
 * Environment configuration — the single seam between process.env and the app.
 * Boot fails fast with the *name* of the missing/invalid variable.
 * Required vs optional mirrors .env.example: the product must boot with
 * every optional integration absent (PRD §132).
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgres://")),
  AUTH_SECRET: z.string().min(16),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_TZ: z.string().default("Asia/Kolkata"),
  JOB_REFRESH_SCHEDULE: z.string().default("0 3,15 * * *"),
  MARKET_COUNTRIES: z
    .string()
    .default("IN")
    .transform((s) =>
      s
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    ),
  CRON_SECRET: z.string().min(8),

  // Required in prod, optional in dev
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  // Optional integrations
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().length(64).optional(), // 32 bytes hex
  SMTP_URL: z.string().optional(),

  // Feature flags (PRD §130)
  CONTACT_DISCOVERY: bool,
  OUTREACH_DIRECT_SEND: bool,
  OUTREACH_DAILY_SEND_CAP: z.coerce.number().int().positive().default(25),
  SEMANTIC_MATCHING: bool,
  EMAIL_NOTIFICATIONS: bool,

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) return cached;
  // Empty-string env values (common in templated .env files) mean "unset".
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration — ${names}`);
  }
  if (env === process.env) cached = parsed.data;
  return parsed.data;
}

/** Test helper: clear the memoized config. */
export function resetConfigForTests(): void {
  cached = null;
}
