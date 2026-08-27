# JobOS

Your job search, one place: real openings from company career sources, real
professional contacts, and customised outreach you approve — no generative AI,
no scraping, no spam.

Built against `SPEC.md` (post-grill v1.0), which amends `PRD.md`.
Primary user: Priyansh. Market: India (`MARKET_COUNTRIES=IN`). Benchmark: jobdululu.com.

## Quick start

```bash
git clone <repo> && cd jobos
cp .env.example .env           # fill AUTH_SECRET + CRON_SECRET
docker compose up -d db        # or any local Postgres 16
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                       # web on :3000
pnpm worker                    # background refresh worker (separate terminal)
```

Sign in with the email magic link — with no `SMTP_URL` set, the link is printed
to the server console (dev mailer). Google sign-in activates when
`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set.

## Layout

```
apps/web        Next.js 15 — UI + API routes (+ Vercel-cron batch endpoint)
apps/worker     long-lived pg-boss worker (local/VPS mode)
packages/core   domain modules: config, queue seam, (Phase 1+) providers, ingestion…
packages/db     Drizzle schema, migrations, seed
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
PW_CHROMIUM_PATH=<chromium> pnpm e2e    # omit the var to use downloaded browsers
```

## Status

- ✅ Phase 0 — Foundation (auth, db, queue seam, UI shell, CI)
- ⏳ Phase 1 — Job data (ATS providers, ingestion, search)
- ⏳ Phase 2 — Outreach core (contacts, email patterns, Gmail drafts, tracker)

See `TICKETS.md` for the full plan and `SPEC.md` for architecture.
