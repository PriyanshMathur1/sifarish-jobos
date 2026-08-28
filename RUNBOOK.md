# Runbook

## Daily operation

- Twice-daily refresh: JOB_REFRESH_SCHEDULE (default 03:00/15:00 IST). Worker mode: schedule runs in-process. Vercel mode: two cron entries hit POST /api/cron/refresh with Authorization: Bearer $CRON_SECRET.
- Missed run: detected on worker boot / next cron hit; at most one catch-up run, trigger='recovery', visible in Admin.
- Admin (/admin): job counts, per-source health (open jobs, last success, status), run history with per-run counters, latest crawl errors, retry buttons. All actions audited.

## Common incidents

- A source keeps failing → consecutive_failures ≥5 pauses it from orchestration for 24h. Fix the board token in the registry (or wait), then "Refresh" on the company row.
- Gmail errors → outreach row shows FAILED with the error; the message text is intact. Reconnect Gmail on /profile and re-approve.
- Queue looks stuck → pg-boss state is in the `pgboss` schema of the same Postgres; `select name, state, count(*) from pgboss.job group by 1,2;`

## Checks

pnpm lint · pnpm format:check · pnpm typecheck · pnpm test · pnpm test:integration · pnpm e2e (set PW_CHROMIUM_PATH to reuse a system Chromium; e2e web server runs with GMAIL_TEST_FAKE=true).
