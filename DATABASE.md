# Database

PostgreSQL 16. Migrations: `packages/db/drizzle/*.sql` (drizzle-kit), applied by `pnpm db:migrate`. `pnpm db:seed` is idempotent: dev user, 18 India-relevant companies, offline sample jobs, built-in templates.

## Table groups

- **Auth**: users, accounts, sessions, verification_tokens (+ authenticators, unused, WebAuthn-ready). DB sessions → revocation = row delete; account deletion cascades everywhere (every user-owned table carries `user_id` FK ON DELETE CASCADE).
- **Candidate**: profiles (skills as ordered jsonb until the taxonomy tables arrive with the matching session), candidate_preferences (with required/preferred strictness jsonb).
- **Job graph**: companies (ATS identity, consecutive_failures for persistent circuit-break), jobs (source facts vs JobOS observations kept separate; `market_eligibility`; generated tsvector + trigram index), job_sources, job_versions (full snapshot per content change), refresh_runs (companies_total vs companies_processed drives completion), crawl_errors, user_job_events (append-only behaviour log).
- **Outreach**: contacts (provenance + suppression), contact_sources, company_email_patterns (learned, evidence-counted), contact_suppressions (email hash — the person, not the record), email_accounts (AES-256-GCM token bundle), templates, outreach_messages (persisted before Gmail; FAILED keeps the text), applications (+ immutable job_snapshot on apply), application_events, notes, reminders.
- **Ops**: audit_logs (append-only).

## Conventions

UUIDv7 PKs (time-ordered). `source_*` columns are source-stated facts and may be null — never fabricated. Repositories in `packages/db/src/repo/` take the owner id and scope every query.
