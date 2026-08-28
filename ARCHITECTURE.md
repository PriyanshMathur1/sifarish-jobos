# Architecture

See SPEC.md for the full post-grill specification; this is the orientation map.

## Shape

pnpm monorepo, one Postgres:

- `apps/web` — Next.js 15 (App Router). UI + API routes, including the Vercel-cron batch endpoint (`POST /api/cron/refresh`).
- `apps/worker` — long-lived Node process for local/VPS deploys: pg-boss polling + cron schedule + missed-run recovery on boot.
- `packages/core` — all domain logic, UI-free. Deep modules with small interfaces:
  - `SafeFetcher` — the ONLY path to external HTTP (SSRF guard, rate limits, retries, circuit breaker, robots opt-in). Raw `fetch` is lint-banned in ingestion/discovery code.
  - `providers/` — `JobProvider` seam + greenhouse/lever/ashby/generic-jsonld adapters. `normalize()` is pure; contract tests run on committed fixtures, zero network.
  - `ingestion/` — refreshCompany state machine (NEW/UPDATED/SAME/UNKNOWN→REMOVED/reactivation, versions), orchestrator (fan-out, run accounting, recovery), MarketFilter (India).
  - `taxonomy/` — titles/skills/locations normalization; data-driven seeds.
  - `contacts/` — PatternEngine (email pattern inference/learning), EmailValidator (5 honest statuses), discovery (JSON-LD Person only, flagged).
  - `outreach/` — TemplateRenderer (strict variables), GmailClient seam (real + fake adapters), prepare/approve service (dedup, caps, suppression; message persisted before Gmail so nothing is ever lost).
  - `queue/` — Queue seam; pg-boss adapter. Handlers registered once (`handlers.ts`), served in BOTH modes: worker polling and serverless drain.
- `packages/db` — drizzle schema, SQL migrations, owner-scoped repositories (the authorization choke point: web code never builds user-scoped queries inline).

## Dual-mode background work

The same handler registry runs as:

1. long-lived worker (`pnpm worker`) — pg-boss polls, cron scheduled in-process;
2. serverless drain — Vercel cron POSTs `/api/cron/refresh` (Bearer CRON_SECRET), which enqueues the orchestrate tick and drains the fan-out inline, then closes fully-processed runs.

## Failure philosophy (PRD §158)

Provider fails → cached jobs remain, two-strike removal never fires on errors, circuit break (per-host in SafeFetcher + persistent per-company counter) pauses the source. Gmail fails → message stored FAILED, text preserved. No Gmail connected → everything except drafts works. Semantic/ML — not present by design in this build (deterministic only).
