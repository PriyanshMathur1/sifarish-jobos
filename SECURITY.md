# Security

- Auth.js v5, database sessions (revocation = delete). Google OAuth in prod; magic link via SMTP_URL, dev logs the link.
- Authorization: owner-scoped repositories in packages/db are the single choke point; admin routes check users.role and audit every action.
- SSRF (PRD §108): SafeFetcher resolves DNS first, blocks private/link-local/CGNAT/metadata ranges (v4+v6, incl. v4-mapped), re-validates every redirect hop, http/https only, streaming 10MB body cap (connection cancelled at the cap).
- Rate limits: per-host token bucket on all outbound crawling; per-user limits on outreach approval and contact import; auth endpoints rate-limited by Auth.js.
- Outreach abuse guards (PRD §80/§157): draft-mode default, per-send approval only (no bulk primitive exists in the code), recipient dedup (14 days), daily send cap (OUTREACH_DAILY_SEND_CAP), suppression enforced at send time, direct send behind OUTREACH_DIRECT_SEND.
- Gmail: minimum scopes (gmail.compose; gmail.send only when direct send enabled), tokens AES-256-GCM encrypted at rest (TOKEN_ENCRYPTION_KEY), decrypted in exactly one module, revocable in-app (tokens deleted).
- Job descriptions sanitized once at ingest (allow-listed tags); CSRF via Auth.js + POST server actions; zod validation on every action/route input; security headers in next.config; CRON_SECRET compared timing-safe.
- Secrets live in env only; .env.example separates required from optional; the product boots with every optional integration absent.
