# JobOS — Tickets (Phases 0–2, locked scope)

Format: `[phase.n] Title — acceptance criteria`. Sequential within a phase; ⛓ marks a hard dependency. TDD-mandated tickets are tagged **[TDD]**.

## Phase 0 — Foundation

- **[0.1] Monorepo scaffold** — pnpm workspaces `apps/web`, `apps/worker`, `packages/core`, `packages/db`; TS strict everywhere; ESLint + Prettier; root scripts `dev/build/lint/typecheck/test`. AC: `pnpm i && pnpm typecheck && pnpm lint` green on fresh clone.
- **[0.2] Local Postgres + env** — docker-compose (pg16), `.env.example` split required/optional, zod-validated env loader in `packages/core/config`. AC: boot fails fast with a named missing var; compose up gives a ready DB.
- **[0.3] Drizzle + initial migration** — users/auth/audit_logs/profiles/profile_skills/candidate_preferences(slim) tables; `pnpm db:migrate`, `db:seed` stubs. AC: migrate-from-zero test passes.
- **[0.4] Auth.js v5** — Google provider + Email magic link with `Mailer` seam (dev adapter logs link); DB sessions; sign-out; account deletion endpoint (cascade). AC: dev sign-in via logged magic link works E2E; sessions revocable by row delete.
- **[0.5] Queue seam + dual-mode worker** — `Queue` interface, pg-boss adapter; `apps/worker` long-lived entry + `POST /api/cron/refresh` batch-drain route guarded by `CRON_SECRET`. AC: demo job enqueued from web is processed in both modes.
- **[0.6] Logging + error tracking** — pino with request/job correlation ids; global error boundary pages (no raw errors, PRD §115). AC: every request logs one structured line; thrown route error renders friendly page.
- **[0.7] UI shell** — layout + nav (Jobs · Contacts · Outreach · Tracker · Profile · Admin), auth gating, empty states per PRD §114, mobile bottom nav. AC: Playwright smoke: sign in → navigate all sections.
- **[0.8] CI pipeline** — GitHub Actions: lint → typecheck → unit → integration (pg service) → e2e. AC: pipeline green on the checkpoint commit.

## Phase 1 — Job Data

- **[1.1] SafeFetcher [TDD]** — SSRF guard (DNS resolve, private/link-local/metadata blocks, redirect re-check, http/https only, 10MB cap), per-host token bucket, timeout, retry+jitter, circuit breaker state, robots awareness; ESLint rule banning raw fetch in core. AC: SSRF table-tests (≥15 cases) green; breaker opens after N failures and recovers.
- **[1.2] Schema: job graph** — companies, company_sources, jobs (+market_eligibility, search tsvector, content_hash), job_sources, job_versions, job_skills, taxonomy tables, refresh_runs, crawl_errors, provider_health. AC: migration + FK/unique constraints tested.
- **[1.3] Taxonomy module + seeds** — normalizeTitle/Skill/Location, seniorityOf, titleSimilarity; seed functions/titles/skills/locations + aliases (India-weighted: Bengaluru/Bangalore, NCR, Mumbai, Pune, Hyderabad, Chennai; PM/growth/fintech title+skill aliases). AC: unit suite incl. ambiguous-alias guards ("PM" context rule).
- **[1.4] JobProvider seam + Greenhouse adapter** — interface + registry; greenhouse boards-api adapter; fixtures (≥2 real boards recorded); pure `normalize`. AC: contract tests: detect/list/normalize snapshots, no network.
- **[1.5] Lever + Ashby adapters** — same seam, same fixture discipline. AC: contract suites green.
- **[1.6] Generic JSON-LD adapter** — schema.org JobPosting via JSON-LD only; conservative field mapping; never fabricate. AC: fixtures incl. a page with no JSON-LD → yields [] not garbage.
- **[1.7] ATS detection** — URL patterns → HTML → script/iframe → JSON-LD presence; confidence stored. AC: fixture table over ≥8 real career-page shapes.
- **[1.8] MarketFilter (IN) [TDD]** — location resolution → IN_CONFIRMED / REMOTE_UNVERIFIED / reject; unstated-region remote kept+flagged. AC: edge-case table (hybrid Bengaluru, "Remote — US only", "Remote (APAC)", bare "Remote", multi-location) green.
- **[1.9] Ingestion state machine [TDD]** ⛓1.1–1.8 — NEW/UPDATED/SAME two-strike UNKNOWN→REMOVED, reactivation, versions, provider-error safety, dedup → job_sources (first-party primary), refresh_runs accounting. AC: integration suite drives full lifecycle on fixtures incl. error-run (nothing removed).
- **[1.10] Orchestrator + cron + recovery** ⛓1.9 — `JOB_REFRESH_SCHEDULE` (default 3:00/15:00 IST), eligible-company fan-out with singleton keys, missed-run backfill (max 1), circuit-broken sources skipped. AC: integration test simulates missed run → exactly one recovery.
- **[1.11] Seed registry (~20 India-relevant boards)** — curated + verified live during dev (fintech/product weighted); committed fixture payloads for dev seed (PRD §129); registry admin-editable. AC: `pnpm db:seed` yields browsable jobs offline; live refresh ingests real jobs.
- **[1.12] Search + filters + job detail** — Postgres FTS + pg_trgm typo tolerance; filters: query, function, location, remote_type, market badge, company, employment type, freshness, source; job detail: full JD (sanitized), source attribution, Posted vs Discovered (never fabricated), apply-out link, save/hide. AC: E2E search scenarios; freshness display rule unit-tested.
- **[1.13] Admin: source health** — provider health, refresh runs, crawl errors, retry company/provider buttons (audited). AC: failed fixture source appears with retry that re-enqueues.

## Phase 2 — Outreach core

- **[2.1] Schema: outreach** — contacts, contact_sources, company_email_patterns, contact_suppressions, email_accounts, templates, outreach_messages, applications, application_events, notes, reminders. AC: migration + owner-scoping tests.
- **[2.2] Contacts CRUD + manual import** — add single (name/company/title/optional email+URL); paste/CSV bulk import with preview + dedup; provenance `manual`. AC: E2E: import 3 contacts from pasted text.
- **[2.3] PatternEngine [TDD]** — pattern library, PRD §70 waterfall, learned company patterns with evidence counts, candidate ranking. AC: table-tests: known-pattern company, unknown company, evidence learning from a verified observation.
- **[2.4] EmailValidator [TDD]** — syntax→domain→MX(cached)→catch-all awareness; statuses VERIFIED/HIGH_CONFIDENCE/PROBABLE/UNKNOWN/INVALID; invariant: inferred can never yield VERIFIED. AC: unit table + invariant property test; MX calls mocked.
- **[2.5] Contact detail + suggestions UI** ⛓2.3–2.4 — suggested emails with confidence labels + copy; "No reliable professional contact found yet" fallback (PRD §74); suppression action. AC: E2E: contact w/o email shows ranked suggestions with labels.
- **[2.6] Templates + TemplateRenderer [TDD]** — 5 built-ins (recruiter intro, HM intro, referral, follow-up, post-apply), user-editable copies; strict variable resolution; `{{relevant_skill}}` = job skills ∩ profile skills resolver. AC: unresolved var blocks preview with a named error; resolver unit-tested.
- **[2.7] Gmail OAuth + GmailClient seam** — Google OAuth (incremental: `gmail.compose` only by default), AES-GCM token encryption, revoke in-app; fake adapter for tests; failure saves local draft (never lose a message). AC: integration with fake adapter; token roundtrip encrypted at rest.
- **[2.8] Composer flow** ⛓2.5–2.7 — job → contact → template → preview (resolved vars, editable) → approve as **draft** (default) or direct send behind `OUTREACH_DIRECT_SEND` + daily cap (25) + recipient/company dedup; per-message approval only, no bulk endpoint. AC: E2E draft path; integration: cap blocks 26th, dedup blocks repeat recipient.
- **[2.9] Tracker (CRM-lite)** — applications with statuses + snapshot-on-apply, table view, notes, reminders (due list on dashboard); status transitions validated. AC: E2E: mark applied → snapshot stored → job removed upstream → snapshot still renders; transition unit tests.
- **[2.10] ContactDiscovery (flagged)** — team/about page fetch via SafeFetcher, JSON-LD Person + conservative HTML extraction, relevance rank (PRD §69), provenance mandatory, suppression honored. AC: fixture suite over 3 page shapes; flag off ⇒ product fully functional.
- **[2.11] Final hardening + docs** — rate limits on submit/search/outreach; security headers; README/ARCHITECTURE/DATABASE/DATA_SOURCES/SECURITY/DEPLOYMENT(+Vercel/Neon runbook)/RUNBOOK; `.env.example` final. AC: full CI green; docs list implemented vs fallback providers + known limitations.

Checkpoint after each phase: lint → typecheck → unit → integration → migrations-from-zero → E2E → `mattpocock-skills:code-review` → commit to `Desktop/Code/02 Fintech & Product/jobos`.

## Phase 0 review log (post code-review amendments)

- getDb(url): explicit connection strings now always get their own pool (was: silently served the cached default DB).
- Repository layer added (`packages/db/src/repo/*`) — owner-scoped choke point in place from the first user-owned table; web pages/actions use `requireUser()`/`requireAdmin()`.
- Account deletion action shipped + E2E (ticket 0.4 gap).
- Cron endpoint now actually enqueues + drains via the shared handler registry in `@jobos/core` (ticket 0.5 gap); queue integration tests cover enqueue/register/drain, singleton dedup (pg-boss "short" policy), and failure containment.
- Request correlation id middleware added; API routes log via `requestLogger`.
- Prettier config + `format:check` in CI; timing-safe CRON_SECRET compare; fileURLToPath for FS paths.
- DECISION (amends ticket 0.3): no `profile_skills` join table until the taxonomy `skills` table exists (Phase 1) — profile skills are a jsonb array meanwhile; migration to the join table happens with ticket 1.3.
- ACKNOWLEDGED scope-ahead: security headers (2.11), profile editor (Phase 2 slice), `authenticators` table (WebAuthn-ready, unused) — kept deliberately.
