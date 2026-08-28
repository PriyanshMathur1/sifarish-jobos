/**
 * Per-user token-bucket rate limiter (SPEC §5). In-process — right for the
 * single-instance V1 deploy; swap the Map for a Postgres/Redis bucket when
 * horizontally scaling (the call-sites won't change).
 */
const buckets = new Map<string, { tokens: number; last: number }>();

export function rateLimit(
  key: string,
  opts: { ratePerMinute: number; burst?: number } = { ratePerMinute: 30 },
): { allowed: boolean } {
  const burst = opts.burst ?? opts.ratePerMinute;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: burst, last: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(burst, b.tokens + ((now - b.last) / 60_000) * opts.ratePerMinute);
  b.last = now;
  if (b.tokens < 1) return { allowed: false };
  b.tokens -= 1;
  return { allowed: true };
}
