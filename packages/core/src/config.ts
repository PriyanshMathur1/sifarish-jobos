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
  HUNTER_API_KEY: z.string().optional(), // free-tier email finder/verifier, single-contact lookups only
  TELEGRAM_BOT_TOKEN: z.string().optional(), // alerts via a personal bot (BotFather)
  ANTHROPIC_API_KEY: z.string().optional(), // only read when LLM_PERSONALISATION is on
  ADMIN_EMAILS: z.string().optional(), // comma-separated sign-in emails granted the admin role
  NOTIFY_FROM: z.string().optional(), // From: for SMTP alerts; defaults to "Sifarish <no-reply@APP_URL host>"

  // Feature flags (PRD §130)
  CONTACT_DISCOVERY: bool,
  OUTREACH_DIRECT_SEND: bool,
  OUTREACH_DAILY_SEND_CAP: z.coerce.number().int().positive().default(25),
  // Campaign rails (AUTOPILOT-PLAN A4). Hard ceilings; campaigns can only ask for less.
  CAMPAIGN_DAILY_CAP_MAX: z.coerce.number().int().positive().default(100),
  CAMPAIGN_PER_COMPANY_14D: z.coerce.number().int().positive().default(2),
  CAMPAIGN_WARMUP_DAYS: z.coerce.number().int().min(0).default(7),
  CAMPAIGN_WARMUP_DAILY_CAP: z.coerce.number().int().positive().default(10),
  SEMANTIC_MATCHING: bool,
  EMAIL_NOTIFICATIONS: bool,
  LLM_PERSONALISATION: bool, // opening lines / cover letters as editable suggestions (grill G6 softened)

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
