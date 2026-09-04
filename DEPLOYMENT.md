# Deployment — sifarish.priyanshmathur.com

Target (grill G7/G8): Vercel Hobby (app + 2 cron jobs) + Neon free Postgres, on a subdomain so the portfolio at the apex is untouched. Local/VPS mode works identically with the long-lived worker instead of cron.

## One-time setup (~20 min)

1. **Neon** (neon.tech): create project `sifarish` → copy the pooled connection string → `DATABASE_URL`.
2. **Vercel**: import the repo. Root directory: `apps/web`. Build command `pnpm --filter @sifarish/web build` (install: `pnpm install`). Add env vars from `.env.example` (required set + AUTH_GOOGLE_*; generate AUTH_SECRET and CRON_SECRET with `openssl rand -hex 32`; TOKEN_ENCRYPTION_KEY with `openssl rand -hex 32`).
3. **Migrations**: `DATABASE_URL=<neon-url> pnpm db:migrate && pnpm db:seed` from your machine (one-off).
4. **Cron**: `vercel.json` (repo root) already declares the two schedules — Vercel picks them up:
   ```json
   {
     "crons": [
       { "path": "/api/cron/refresh", "schedule": "30 21 * * *" },
       { "path": "/api/cron/refresh", "schedule": "30 9 * * *" }
     ]
   }
   ```
   (21:30/09:30 UTC = 03:00/15:00 IST.) Vercel sends the CRON_SECRET automatically when set as an env var named `CRON_SECRET`.
5. **Domain**: Vercel project → Domains → add `sifarish.priyanshmathur.com`. At Namecheap: CNAME `sifarish` → `cname.vercel-dns.com`. The apex/portfolio DNS is untouched.
6. **Google OAuth** (sign-in): Google Cloud console → OAuth client (Web) → redirect URIs `https://sifarish.priyanshmathur.com/api/auth/callback/google` (+ localhost for dev) → `AUTH_GOOGLE_ID/SECRET`.
7. **Gmail** (outreach drafts): same project → enable Gmail API → add scope `gmail.compose` on the consent screen (testing mode + yourself as test user is enough) → redirect URI `https://sifarish.priyanshmathur.com/api/gmail/callback` → `GMAIL_OAUTH_CLIENT_ID/SECRET` (reusing the sign-in client is fine).

## Local / VPS mode

`docker compose up -d db` → `pnpm db:migrate && pnpm db:seed` → `pnpm dev` + `pnpm worker`. The worker carries the schedule and missed-run recovery; no cron entries needed.

## Notes

- Serverless drain processes up to 500 company refreshes per cron hit (maxDuration 300s); 18 seed companies complete in well under a minute.
- The app boots with every optional var absent — Gmail/SMTP/discovery features simply report themselves unconfigured.


## Autopilot ticker (GitHub Actions)

Vercel Hobby crons fire at most daily, so the 15-minute "watch" and hourly
"normal" refresh ticks come from `.github/workflows/ticker.yml`. Set two
repository secrets (Settings → Secrets and variables → Actions):

| Secret                 | Value                                        |
| ---------------------- | -------------------------------------------- |
| `SIFARISH_APP_URL`     | `https://sifarish.priyanshmathur.com`        |
| `SIFARISH_CRON_SECRET` | the same `CRON_SECRET` set in Vercel env     |

The workflow POSTs `/api/cron/refresh?tier=watch` every 15 minutes and
`?tier=normal` hourly. The two Vercel crons keep running the full reconcile
(with `refresh_runs` accounting and missed-run recovery). Mark companies as
"Watching" on the Admin page to put them in the 15-minute tier. "Run
workflow" in the Actions tab triggers a tick by hand (`tier=full` runs the
reconcile path).

Alerts go out on every call: instant alerts for new jobs at or above the
user's band, and the daily digest once its hour (APP_TZ) has passed. Channels
need `SMTP_URL` (email) or `TELEGRAM_BOT_TOKEN` (Telegram) in Vercel env.
