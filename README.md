# Sifarish

Your job search on autopilot: openings from company career sources scored
against your profile within minutes of appearing, alerts on your phone,
applications filled and submitted from your own computer, and outreach
campaigns that send from your own Gmail inside caps. No scraping, no spam,
nothing generated that you don't see first.

Built against `SPEC.md` (post-grill v1.0), which amends `PRD.md`.
Primary user: Priyansh. Market: India (`MARKET_COUNTRIES=IN`). Benchmark: jobdululu.com.

## Quick start

```bash
git clone <repo> && cd sifarish
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
apps/web          Next.js 15 — UI + API routes (+ cron/ticker drain endpoint, runner API)
apps/worker       long-lived pg-boss worker (local/VPS mode)
apps/apply-runner Playwright CLI that runs on YOUR computer and drives hosted ATS forms
packages/core     domain modules: providers, ingestion, matching, alerts, outreach, campaigns
packages/db       Drizzle schema, migrations, repositories, seed
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
PW_CHROMIUM_PATH=<chromium> pnpm e2e    # omit the var to use downloaded browsers
```

## Status

- ✅ Phase 0 — Foundation (auth, db, queue seam, UI shell, CI)
- ✅ Phase 1 — Job data (SafeFetcher, 4 ATS providers, India market filter, ingestion state machine, twice-daily orchestrator, search, admin)
- ✅ Phase 2 — Outreach core (contacts + provenance, email-pattern engine + honest validation, templates with smart variables, Gmail drafts via OAuth, per-send approval with caps/dedup/suppression, application tracker with snapshots, notes, reminders)
- ✅ Autopilot A — Watch: deterministic MatchingEngine with reasons, For-you feed, Profile v2 (application details, resumes, answer bank, preferences), instant + daily alerts (SMTP / Telegram), tiered 15-minute refresh via a GitHub Actions ticker
- ✅ Autopilot B — Reach: campaigns approved once and drained inside rails (daily cap, warm-up, per-company cap, spacing, dedup, bounce breaker), in-thread follow-ups, reply/bounce sync over message headers, LinkedIn connections CSV import (own export), contact edit, admin discovery pages
- ✅ Autopilot C — Apply: rules-built queue, device-token runner API, `apps/apply-runner` with a label-driven filler and Greenhouse/Lever/Ashby adapters, confirm and hands-off modes, Needs-you inbox that teaches the answer bank
- ✅ Autopilot D — Workable + SmartRecruiters ingestion, optional AI opening line (`LLM_PERSONALISATION`), analytics funnel

See `docs/AUTOPILOT-PLAN.md` for the design decisions behind all of it.

Docs: `SPEC.md` (locked spec) · `TICKETS.md` (plan + review logs) · `ARCHITECTURE.md` · `DATABASE.md` · `DATA_SOURCES.md` · `SECURITY.md` · `PRIVACY.md` · `DEPLOYMENT.md` (Vercel+Neon+domain runbook) · `RUNBOOK.md` · `MATCHING.md` / `ML.md` (deferred-scope notes)

## Known limitations (V1, deliberate)

- **Live-source verification**: the build sandbox has no egress to ATS hosts; provider behaviour is verified against recorded real payloads (Postman/FamPay/Linear boards). First live refresh happens on your machine or the deploy.
- **Catch-all detection**: EmailValidator stops at MX. True catch-all detection needs SMTP RCPT probing, which the PRD forbids as abusive — this is exactly why inferred addresses are never labelled better than HIGH_CONFIDENCE.
- **In-process rate limiter**: per-instance on serverless; the durable guards are the DB-backed daily send cap + recipient dedup, which hold across instances.
- **Contact discovery** is JSON-LD-Person-only and flagged off by default; most company pages lack structured people data. Manual add/import is the designed primary path.
- **Templates**: the 5 built-ins render with strict variables; a custom-template editor UI is deferred (schema supports it).
- **Hosted-form adapters** were built against the documented structure of Greenhouse, Lever and Ashby forms and verified on a fixture form in a real browser; the first runs against live boards will surface field-label quirks, which the answer bank and "Needs you" flow are designed to absorb. Workable/SmartRecruiters ingest but are not yet runner-supported.
- **LinkedIn / Naukri**: never automated, by design. The only LinkedIn data used is your own connections export.
