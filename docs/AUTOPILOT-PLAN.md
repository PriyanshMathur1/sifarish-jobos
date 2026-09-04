# Sifarish Autopilot: plan

Version: 1.0 (built, September 2026). Status per phase is in README.md; this file keeps the reasoning.
Amends: `SPEC.md` v1.0. Where this document and SPEC disagree, the decisions in section 1 win once approved.

Goal in one line: Sifarish watches the market continuously, tells Priyansh within minutes when a matching role appears, applies for him wherever that can be done from his own identity without breaking anyone's rules, and runs personalised outreach campaigns from his Gmail at a volume that keeps the mailbox healthy.

---

## 0. Where we are today

| Area | Shipped | Ceiling that blocks "autopilot" |
| --- | --- | --- |
| Job data | 56 companies (27 Greenhouse, 17 Lever, 11 Ashby, 1 JSON-LD), refreshed 03:00 and 15:00 IST via two Vercel crons | Twice a day is not real time; Vercel Hobby crons cannot run more often than daily per job; registry is small; no Workday/SmartRecruiters/Darwinbox/Keka adapters |
| Matching | FTS search + freshness sort; behaviour events logged | No scoring engine, no "for you" feed, no alerts (deferred by G3) |
| Profile | Name, title, years, skills, locations | No resume storage, no phone/LinkedIn URL/work-auth answers, nothing an application form needs |
| Outreach | Draft-only by default; direct send behind flag with 25/day cap; 14-day dedup; bulk drafting up to 25 at a time | No campaigns, no send queue, no follow-up sequences, no reply or bounce detection (compose-only Gmail scope) |
| Contacts | Manual/CSV import, pattern engine, MX validation, Hunter single lookup, discovery behind flag | Supply is thin; discovery has no per-company page URL to work from |
| Apply | "Apply at source" link + manual "Mark applied" | Nothing automated |

---

## 1. Decisions to lock (proposed amendments to SPEC grill decisions)

| # | Proposed decision | Replaces |
| --- | --- | --- |
| A1 | **Refresh cadence becomes tiered**: watchlist companies every 15 min, everyone else every 60 min, full reconcile twice a day. Scheduler moves off Vercel Hobby cron (daily-only) to a free external ticker (GitHub Actions `schedule`, hitting `/api/cron/refresh` with `CRON_SECRET`) or a long-lived worker on Railway/Fly. Vercel crons stay as the twice-daily safety net. | G8, G10 |
| A2 | **Matching engine ships now** (PRD §40 weights, deterministic, explainable), plus a "For you" feed and instant alerts. | G3 deferral |
| A3 | **Assisted apply, not blind auto-apply.** Applications go through the ATS's own hosted form, from Priyansh's own browser and identity, prefilled from his profile and resume. Default is "prefill then one click to confirm"; "hands-off" mode is allowed only for roles above a match threshold whose form has no custom essay questions. Any CAPTCHA, login wall, or unknown field stops and hands over to him. Never on LinkedIn, Naukri, or any site whose terms forbid automation. | New |
| A4 | **Bulk send with guardrails replaces "no bulk send, ever."** A campaign is approved once as a batch, then drained by the worker one message at a time with spacing, daily and per-company caps, dedup, bounce and reply handling, and an automatic stop on reply. Per-message approval goes away; per-batch approval stays. | G5, PRD §80/§157 |
| A5 | **Gmail scope grows** from `gmail.compose` to `gmail.send` + `gmail.readonly` restricted by query (only threads Sifarish started, matched by its own `X-Sifarish-Id` header / thread IDs). Needed for reply and bounce detection. PRIVACY.md and the consent copy change to say so. | Security §5 |
| A6 | **Personalisation stays deterministic by default** (G6). A flagged `LLM_PERSONALISATION` mode may draft the first line of an email and a short cover letter from the JD + profile, always shown in preview, never sent unreviewed. Cost is Priyansh's API key. | G6 (softened) |
| A7 | **Contact supply grows only from user-owned or company-published data**: LinkedIn "Download your data" connections CSV (his own export), per-company team-page URLs set in admin, Hunter free tier, pattern engine. No LinkedIn scraping, no bulk people databases. | G4 (held) |

---

## 2. Target architecture

```
                 ┌──────────── external ticker (GitHub Actions / worker) ─────────────┐
                 ▼                                                                    │
apps/web ──── /api/cron/refresh ── Queue ── refresh.company (tiered) ── Providers ────┤
   │                                  │                                               │
   │                                  ├── match.recompute(user, jobIds) ── MatchingEngine
   │                                  │          │
   │                                  │          └── alert.dispatch ── Notifier seam (email, Telegram)
   │                                  │
   │                                  ├── campaign.drain ── Outreach v2 ── GmailClient (send)
   │                                  ├── mailbox.sync ──── ReplyDetector ── GmailClient (readonly, scoped)
   │                                  └── followup.schedule ── Sequences
   │
   └── /api/apply/* ◄──── apps/apply-runner (Playwright on Priyansh's PC, or Chrome extension)
                            prefill from profile + resume, confirm, report back
```

New deep modules (interfaces first, tests across the seam):

- **MatchingEngine** `score(job, profile, prefs) → {score 0..100, band, reasons[]}`. Pure. Hard gates first (India eligibility, seniority range, must-have skills, salary floor if stated), then weighted terms: title similarity, skill overlap weighted by profile priority, company fit (watchlist, size, sector), freshness, remote preference. Reasons are strings the UI shows verbatim ("3 of your top 5 skills", "title matches 'Product Manager' at 0.91").
- **Notifier** seam `notify(userId, event)` with adapters: email-to-self via the same Gmail token, Telegram bot (cheapest true push on a phone), in-app inbox. Digest and instant modes per preference.
- **Campaign** `create(contactIds, templateId, jobId?, sequence?) → Campaign`, `approve(campaignId)`, `drain(n)`. Hides spacing, caps, dedup, retries, bounce learning, stop-on-reply. Status machine: `DRAFT → APPROVED → RUNNING → PAUSED|DONE`. Each message keeps the existing `outreach_messages` row.
- **ReplyDetector** `sync(userId) → {replied[], bounced[]}`. Reads only threads Sifarish created. Bounce → contact `INVALID` + negative evidence on the company pattern. Reply → message `REPLIED`, application `CONTACTED → REPLIED`, sequence cancelled, reminder created.
- **ApplyRunner** (runs on the PC, talks to the web app over an authenticated API): `plan(jobId) → ApplyPlan` (form URL, field map, answer bank hits, unknowns), `execute(plan, mode: confirm|handsoff) → ApplyResult`. Adapters per hosted-form family: Greenhouse (`job-boards.greenhouse.io`), Lever (`jobs.lever.co`), Ashby (`jobs.ashbyhq.com`). Anything else returns `unsupported` and opens the page for manual apply with the profile copied to clipboard.
- **AnswerBank** `answer(question) → {value, confidence}`: normalised standard questions (work authorisation, notice period, current CTC, expected CTC, location, LinkedIn, portfolio, "how did you hear") keyed by taxonomy, with Priyansh's saved answers. Unknown question → stop and ask, then remember.

New tables:

```
resumes(id, user_id, label, storage_key, mime, bytes, is_default, created_at)
answer_bank(id, user_id, question_key, question_text_sample, answer, updated_at)
job_matches(user_id, job_id, score, band, reasons jsonb, computed_at, pk(user_id, job_id))
alert_preferences(user_id pk, channel enum(email,telegram,none), mode enum(instant,digest), min_band, telegram_chat_id?)
alerts(id, user_id, job_id, channel, sent_at, opened_at)
campaigns(id, user_id, name, template_id, job_id?, sequence_id?, status, approved_at, daily_cap, spacing_sec, created_at)
campaign_recipients(campaign_id, contact_id, outreach_message_id?, state enum(QUEUED,SENT,SKIPPED,BOUNCED,REPLIED,FAILED), skip_reason?, pk(campaign_id, contact_id))
sequences(id, user_id, name, steps jsonb)            -- [{day:0, template_id}, {day:4, template_id}, {day:10, template_id}]
apply_attempts(id, user_id, job_id, mode, status enum(PLANNED,PREFILLED,SUBMITTED,BLOCKED,FAILED), blocker?, form_url, submitted_at, created_at)
company_pages(company_id, kind enum(team,about,leadership), url, pk(company_id, url))   -- feeds ContactDiscovery
```

---

## 3. Phases

Each phase ends with typecheck, lint, unit, integration, e2e green, a code review pass, then a bundle to push.

### Phase A: Watch (real-time finding + alerts)

1. Tiered refresh: `companies.priority enum(watch, normal)`, per-tier schedules in config, conditional requests (ETag / If-Modified-Since) so 15-minute polling of 60 boards costs almost nothing.
2. External ticker: `.github/workflows/refresh.yml` on `*/15 * * * *` calling `/api/cron/refresh?tier=watch`, hourly for `normal`. Vercel crons keep the twice-daily full reconcile.
3. Profile v2: phone, LinkedIn URL, portfolio, notice period, current and expected CTC, work authorisation, resume upload (Vercel Blob, 5 MB cap, PDF only) with a default flag. Everything an application form asks for lives here once.
4. MatchingEngine (TDD) + `job_matches` recompute on ingest (`match.recompute` queued per refresh run, only for NEW/UPDATED jobs).
5. "For you" feed: bands (Strong, Good, Maybe) with reasons; hide/save feed back into weights as user signals.
6. Alerts: Notifier seam; email-to-self adapter first (zero new infra), Telegram adapter second. Instant for Strong, digest at 09:00 IST for Good.
7. Provider expansion behind the same `JobProvider` seam: Workable, SmartRecruiters (public postings API), Darwinbox and Keka (India-heavy; JSON-LD or public API where published), Workday (public `cxs` job feed per tenant). Only endpoints the vendor publishes for embedding. Seed registry grows toward ~150 India-relevant companies.

Exit: a matching role posted on a watched board shows up on his phone within 15 minutes with a reason and a one-tap open.

### Phase B: Reach (bulk Gmail with guardrails)

1. Gmail scope change and re-consent; PRIVACY.md and consent copy updated; `X-Sifarish-Id` header on every message.
2. Campaign module (TDD): batch approval, worker drain with spacing (default 120 s), daily cap (default 40, hard max 100, both admin-editable), per-company cap (default 2 per 14 days), 14-day recipient dedup, suppression list, retry with backoff, pause/resume.
3. Sequences: day-0 / day-4 / day-10 follow-ups, cancelled on reply, bounce, or manual stop. Follow-ups reply in-thread.
4. ReplyDetector via `mailbox.sync` every 30 min: bounces learn negative pattern evidence; replies update tracker and cancel sequences.
5. Contacts supply: LinkedIn connections CSV import (own export, maps to name/company/title), `company_pages` in admin + "Discover all" batch job, contact edit screen (currently missing), bulk Hunter lookup capped to the free quota.
6. Deliverability hygiene built in: plain-text-first bodies, one link max, no tracking pixels, unsubscribe line, warm-up ramp (10/day for the first week on a fresh token), automatic pause if bounce rate over 5% in a day.
7. UI: Campaigns page (list, progress, replies), campaign composer replacing the current bulk review page, sequence editor.

Exit: select 60 contacts, approve once, the worker sends 40 today and 20 tomorrow with follow-ups scheduled, and replies land in the tracker without anyone opening Gmail.

### Phase C: Apply (assisted application)

1. `apps/apply-runner`: Playwright script that logs in to Sifarish with a device token, pulls the apply queue, opens each hosted form in a visible browser, prefills, and either waits for confirm or submits (hands-off mode). Runs on the PC on demand or on a schedule; never in the cloud (his resume, his IP, his identity).
2. Form adapters for hosted forms, in order: Greenhouse, Lever, Ashby (the current registry), then Workable, SmartRecruiters, Darwinbox, Keka, Zoho Recruit, BambooHR, Freshteam, Workday (account-creation step handled with his email; verification hands over). Each gets a matching ingestion adapter first so the roles appear in the feed. Field discovery by label and autocomplete attributes, resume upload, EEO sections left blank unless he opts in, custom questions routed to AnswerBank. LinkedIn Easy Apply and Naukri are explicitly out: their terms forbid automation and enforcement means a restricted account.
3. AnswerBank with the standard India questions seeded; unknown question pauses the run and asks in the app, then remembers.
4. Auto-queue rules: "queue Strong matches automatically", "queue Good matches after I save them", per-company opt-out, daily apply cap (default 10). Every attempt logged to `apply_attempts` and mirrored to the tracker as APPLIED with the form snapshot.
5. Safety rails in code, not policy: CAPTCHA detected → stop and notify; login wall → stop; domain not in the supported list → stop; per-run screenshot of the confirmation page stored with the attempt.

Exit: morning routine is "open the app, see 8 applications submitted overnight in confirm mode waiting for one click each, 3 blocked with a reason".

### Phase D: Compound (quality and scale)

Optional `LLM_PERSONALISATION` (first line, cover letter, tailored resume summary; always previewed), embeddings for semantic matching (`SEMANTIC_MATCHING` flag already exists), analytics funnel (alert → open → apply → reply → interview), weekly review email, multi-user hardening if this ever leaves one user.

---

## 4. What this plan deliberately does not do

- Scrape LinkedIn, Naukri, Indeed, or competitor apps, or automate against sites whose terms forbid it. Account bans and legal exposure fall on Priyansh, and the same roles are on the first-party boards anyway.
- Submit applications through Greenhouse or Lever APIs. Those endpoints require the hiring company's own API key; the hosted form is the sanctioned path.
- Bypass CAPTCHAs. Ever. The runner hands over.
- Fire-and-forget mass mail. Gmail personal limits are 500/day on paper, but cold-email reputation collapses far below that and a flagged account loses the whole channel. Caps and spacing are the feature.
- Blind auto-apply to weak matches. It burns future chances at the same company; the threshold and per-company opt-out exist for that reason.

---

## 5. Open questions for Priyansh

1. Caps: 40/day sends and 10/day applies as defaults, hard max 100 sends. Agree?
2. Apply runner packaging: Playwright script on the PC (fastest to build, `pnpm apply` in a terminal) or a Chrome extension (nicer, roughly 2x the work)? Recommendation: script first, extension later if it sticks.
3. Alerts channel: Telegram bot (true push, 20 min to set up) or email-to-self only?
4. LLM personalisation: on with his own Anthropic key, or keep everything deterministic?
5. Scheduler: GitHub Actions ticker (free, 15-min floor, occasionally delayed) or a small always-on worker on Railway (~$5/month, exact timing)?
6. Gmail readonly for reply detection: yes, or keep compose+send only and update reply status by hand?

---

## 6. Rough effort

| Phase | Sessions | Depends on |
| --- | --- | --- |
| A Watch | 3 to 4 | Nothing; starts immediately |
| B Reach | 3 to 4 | A3 (profile v2) for template variables; can overlap with A |
| C Apply | 4 to 5 | A3 (profile v2 + resume), AnswerBank |
| D Compound | ongoing | A, B, C |

Suggested order: A1 to A6 first (alerts are the single biggest daily-life change), then B, then C. Provider expansion (A7) can be interleaved anywhere.
