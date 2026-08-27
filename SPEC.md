# JobOS — Engineering Specification

Version: 1.0 (post-grill, locked)
Source of truth: `PRD v2.0`, amended by grill decisions below. Benchmark product: jobdululu.com ("connect Gmail → pick contacts → send personalized emails to recruiters/founders"). JobOS differentiator: the outreach is driven by a live first-party **job graph**, not a static contact database.

Design language: deep-module vocabulary — **module / interface / implementation / seam / adapter / depth**.

---

## 0. Grill decisions (amendments to the PRD)

| #   | Decision                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **User #1 is Priyansh** (PM/growth, fintech, India). General engine, personal seed/tuning.                                                                                                                                                                                                     |
| G2  | **India-only jobs**: `MARKET_COUNTRIES=IN` ingest filter. Keep a job if any location resolves to India, OR remote + explicitly India/APAC/anywhere-eligible. Remote with **unstated region**: kept, ranked below confirmed-India, badged "Remote — eligibility unverified".                    |
| G3  | **Outreach-first re-cut**: build order = Foundation → Job Data → **Outreach core** (PRD Phases 5+6, slimmed 4). Matching engine/feed (PRD Phase 2 ranking), notifications, analytics, embeddings, ML → later sessions. Profile shrinks to what templates + filters need.                       |
| G4  | **Contacts**: manual import is first-class (paste/CSV: name, company, title); auto-discovery from public pages is best-effort enhancement. No LinkedIn scraping, no paid APIs. Real leverage = email-pattern engine + validation.                                                              |
| G5  | **Send mechanism**: Gmail API **drafts by default** (user sends from Gmail); direct send behind `OUTREACH_DIRECT_SEND` flag with daily cap (default 25), recipient dedup, per-send approval. No bulk auto-send, ever (PRD §80/§157 held).                                                      |
| G6  | **Customisation = deterministic**: templates + smart variables (`{{relevant_skill}}` = job skills ∩ profile skills). No generative AI (PRD §6).                                                                                                                                                |
| G7  | **Domain**: `jobs.priyanshmathur.com` (apex stays the Cloudflare Pages portfolio; one CNAME at Namecheap).                                                                                                                                                                                     |
| G8  | **Runtime host**: Vercel Hobby + Neon Postgres, designed-for now, deployed later. Worker is **dual-mode**: long-lived pg-boss process locally; batch-drain endpoint invoked by 2 Vercel cron jobs (3:00 & 15:00 IST) in prod. Deploy artifacts + wizard shipped, account setup is a follow-up. |
| G9  | Auth: Google-only in prod until a mailer is wired; magic link works in dev (logged links).                                                                                                                                                                                                     |
| G10 | Refresh 3:00/15:00 `Asia/Kolkata` via `JOB_REFRESH_SCHEDULE`; never hardcoded.                                                                                                                                                                                                                 |
| G11 | Accepted V1 ceilings: single Postgres (data+queue+FTS); strict JSON-LD-only generic provider; full JD display with source attribution + apply-out link; seed list curated by Claude (~20 India-relevant verified ATS boards), admin-editable.                                                  |

## 1. Stack decisions (unchanged from draft where not amended)

pnpm monorepo (`apps/web` Next.js 15 App Router + TS strict, `apps/worker`, `packages/core`, `packages/db`); PostgreSQL 16 + Drizzle; pg-boss queue/cron behind a `Queue` seam; Auth.js v5 (Google + magic link w/ `Mailer` seam); Postgres FTS + `pg_trgm` (no Elasticsearch); UUIDv7 PKs; Vitest + Playwright; pino structured logs; zod validation at every route; Docker Compose for local Postgres.

## 2. Architecture

```
apps/web (Next.js: auth, search, contacts, composer, tracker, admin)
   │ imports
packages/core ──────────────────────────────────────────────
  SafeFetcher · ProviderRegistry(JobProvider seam) · Ingestion
  Taxonomy · MarketFilter(IN) · SearchQuery
  ContactImport · ContactDiscovery · PatternEngine
  EmailValidator · TemplateRenderer · Outreach · GmailClient seam
   │ imports
packages/db (Drizzle schema, migrations, owner-scoped repositories)
   │
PostgreSQL 16  ←— pg-boss (same instance) —→  apps/worker (dual-mode)
```

**Deep modules & interfaces** (tests cross the same seam callers do):

- **SafeFetcher** — `fetch(url, opts) → Result<Response, FetchError>`. Hides SSRF guard (DNS resolve, private/metadata IP block, redirect re-validation, http/https only, 10MB cap), per-host token-bucket rate limits, timeout, retry+jitter, circuit breaker, robots awareness. Lint rule bans raw `fetch` in providers/discovery.
- **JobProvider** — `detect / listJobs / getJob / normalize(pure) / healthCheck`. Adapters: `greenhouse`, `lever`, `ashby`, `generic-jsonld` (schema.org JobPosting JSON-LD only; never fabricate fields). Fixture-driven contract tests, zero live network in CI.
- **Ingestion** — `refreshCompany(companyId, runId) → RefreshOutcome`. Snapshot compare via external ID + content hash; NEW/UPDATED/SAME/MISSING; two-strike removal (ACTIVE→UNKNOWN→REMOVED) only on successful listings — provider errors never remove; reactivation; `job_versions`; dedup (ATS id → canonical URL → company+title+location+simhash) into `job_sources` with first-party primary; **MarketFilter applied at ingest** (G2), rejected jobs counted, not stored.
- **Taxonomy** — `normalizeTitle/Skill/Location`, `titleSimilarity`, `seniorityOf`. Data-driven (tables + seed files); "PM"-style ambiguous aliases guarded by context.
- **PatternEngine** — `inferEmails(contact, company) → Candidate[]` ranked by pattern confidence. Hides: pattern library (`first.last`, `first`, `f.last`, `flast`, `first_last`…), per-company learned patterns (`company_email_patterns` with evidence counts from verified observations), waterfall of PRD §70 (known verified → public → company pattern → generated). Pure given inputs.
- **EmailValidator** — `validate(email) → {status, checks}`. Syntax → domain → MX (cached per domain) → catch-all awareness. Statuses only from PRD §73: `VERIFIED / HIGH_CONFIDENCE / PROBABLE / UNKNOWN / INVALID`; inferred ≠ verified, ever. No abusive SMTP probing.
- **TemplateRenderer** — `render(template, ctx) → {subject, body, missingVars}`. Strict: unresolved variables surface as errors in preview, never silently blank. `{{relevant_skill}}` resolver = highest-priority intersection of job skills and profile skills.
- **GmailClient (seam)** — `createDraft(msg)`, `send(msg)`, `listRepliesTo(threadIds)`. Adapters: real Gmail API (OAuth, minimal scopes: `gmail.compose` for drafts; `gmail.send` added only when direct-send flag on); fake for tests. Tokens encrypted at rest (AES-GCM, key in env). Failure → message saved as local draft, never lost (PRD §123).
- **Outreach** — `prepare(jobId?, contactId, templateId) → Preview`, `approve(previewId, mode: draft|send)`. Hides: variable resolution, dedup (recipient / company frequency), daily-cap enforcement, status machine (DRAFTED→SENT→REPLIED/BOUNCED), follow-up reminder creation. Direct send requires flag + per-message approval — no bulk API exists by design.
- **ContactDiscovery** (best-effort, feature-flagged `CONTACT_DISCOVERY`) — given a company: fetch team/about/careers pages via SafeFetcher, extract people (name+title) from JSON-LD `Person`, semantic HTML patterns; deterministic relevance rank per PRD §69. Provenance (`source_url`, `source_type`) mandatory; suppression honored on rediscovery.

## 3. Database (this build's tables)

Draft-spec §3 tables carry over: `users`+Auth.js tables, `profiles`, `profile_skills`, `resumes`(deferred-lite: upload+store only), `candidate_preferences`(slimmed), `companies`, `company_sources`, `jobs`(+`market_eligibility enum(IN_CONFIRMED, REMOTE_UNVERIFIED)`), `job_sources`, `job_versions`, `job_skills`, taxonomy tables, `user_job_events`(SAVE/HIDE/OPEN/APPLY/CONTACT), `refresh_runs`, `crawl_errors`, `provider_health`, `audit_logs`. **Dropped from this build**: `job_matches` (arrives with matching session).

New for Outreach core:

```
contacts(id, user_id, company_id?, full_name, title, normalized_title, department,
         seniority, professional_urls jsonb, business_email, email_status,
         email_confidence, source_url, source_type enum(manual,discovered),
         last_verified_at, suppressed_at, created_at, updated_at)
contact_sources(id, contact_id, url, kind, observed_at)
company_email_patterns(company_id, pattern, confidence, evidence_count, last_verified, pk(company_id,pattern))
contact_suppressions(id, email_hash uq, domain, reason, created_at)
email_accounts(id, user_id uq, provider enum(gmail), email, oauth_tokens_enc,
               scopes jsonb, connected_at, revoked_at)
templates(id, user_id?, name, kind enum(recruiter_intro,hm_intro,referral,followup,post_apply),
          subject, body, is_builtin, created_at, updated_at)
outreach_messages(id, user_id, contact_id, job_id?, template_id, subject, body,
                  mode enum(draft,send), status enum(PREPARED,DRAFTED,SENT,REPLIED,BOUNCED,FAILED),
                  gmail_draft_id?, gmail_thread_id?, sent_at, created_at)
applications(id, user_id, job_id, status enum(INTERESTED,SAVED,APPLIED,CONTACTED,SCREENING,
             INTERVIEW,FINAL_ROUND,OFFER,REJECTED,WITHDRAWN), job_snapshot jsonb,
             applied_at, notes_count, created_at, updated_at, uq(user_id, job_id))
application_events(id, application_id, from_status, to_status, at)
notes(id, user_id, subject_type enum(job,company,application,contact), subject_id, body, created_at)
reminders(id, user_id, subject_type, subject_id, due_at, message, done_at, created_at)
```

Owner scoping at the repository layer (single choke point); every user-owned table has `user_id`.

## 4. Pipelines

**Ingestion** (unchanged from draft §4) + MarketFilter at normalize step. Cron `JOB_REFRESH_SCHEDULE` default `0 3,15 * * *` IST; `refresh_runs` accounting; missed-run recovery on boot; dual-mode worker (G8): `pnpm worker` locally, `POST /api/cron/refresh` (Vercel cron, auth via `CRON_SECRET`) drains the same queue in time-boxed batches.

**Outreach flow** (PRD §79 held): pick job → see/import contacts → PatternEngine proposes emails with confidence labels → pick template → preview with resolved variables (missing vars block) → edit → approve as **Gmail draft** (default) or direct send (flag + cap). Reply detection (Phase-later; `listRepliesTo` seam exists). Follow-up reminders user-created; surfaced on dashboard.

## 5. Security & privacy

Draft §6 carries over wholesale (Auth.js DB sessions, CSRF, zod, repo-level authz, SSRF guard, sanitized JD HTML at ingest, rate limits, security headers, secrets server-side, `.env.example` split required/optional). Additions: Gmail OAuth tokens AES-GCM encrypted, revocable in-app; minimal scopes, `gmail.send` requested only when flag enabled; contact data = professional info only (no personal phones/addresses, PRD §110); suppression list honored everywhere (display, discovery, send); every send/draft action audit-logged.

## 6. Testing

| Layer                       | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (Vitest, TDD)          | MatchingEngine deferred; instead: **PatternEngine** (pattern gen, waterfall, learned-pattern evidence), **EmailValidator** (status table-tests, never-verify-inferred invariant), **TemplateRenderer** (strict vars, relevant_skill resolver), SafeFetcher SSRF table-tests, Ingestion change-detection + two-strike machine, MarketFilter edge cases (unstated-region remote), taxonomy normalization, dedup fingerprints, application status transitions |
| Contract                    | Fixture suites per provider (greenhouse/lever/ashby/generic-jsonld): detect, parse, normalize snapshots. No live network in CI                                                                                                                                                                                                                                                                                                                             |
| Integration (test Postgres) | Ingestion end-to-end on fixtures; migrations from zero; repo owner-scoping; outreach prepare→approve with fake GmailClient (draft created, cap enforced, dedup blocks repeat)                                                                                                                                                                                                                                                                              |
| E2E (Playwright)            | signup → slim profile → seeded jobs searchable + filtered (India badge visible) → open job → add contact manually → pattern-suggested email w/ confidence label → pick template → preview shows resolved vars → approve as draft (fake Gmail in test) → tracker shows CONTACTED → reminder created                                                                                                                                                         |

CI: lint → typecheck → unit+contract → integration → e2e per phase checkpoint (PRD §152), then mattpocock code-review, then commit to `Desktop/Code`.

## 7. Implementation sequence (this session)

- **Phase 0 — Foundation**: scaffold, strict TS/ESLint (+no-raw-fetch rule), Drizzle + initial migrations, Auth.js (Google + dev magic link), pg-boss + dual-mode worker skeleton, pino, CI, UI shell (nav: Jobs · Contacts · Outreach · Tracker · Profile · Admin), Playwright smoke. _Exit: fresh clone boots + signs in, checks green._
- **Phase 1 — Job Data**: SafeFetcher (TDD) → provider seam + 4 adapters + fixtures → company registry + ATS detection → Ingestion (TDD) + versions + dedup + MarketFilter → orchestrator/cron/refresh_runs/recovery → FTS search + filters + job detail → seed ~20 verified India-relevant boards → minimal admin (source health, runs, retry). _Exit: real India jobs ingested twice-daily-capable; search works; suites green._
- **Phase 2 — Outreach core**: contacts CRUD + manual import (paste/CSV) → PatternEngine (TDD) + EmailValidator (TDD) + learned patterns → templates (5 built-ins, editable) + TemplateRenderer (TDD) → Gmail OAuth + GmailClient + encrypted tokens → composer flow (preview→approve→draft/send+cap) → tracker (applications, statuses, notes, reminders) → ContactDiscovery best-effort behind flag. _Exit: E2E critical path green; you can go job → contact → customised draft in your Gmail in under a minute._

Deferred (next sessions): matching engine + Discover feed, notifications/digests, analytics funnel, reply tracking, embeddings (`SEMANTIC_MATCHING`), Tier-2 providers, ML.
