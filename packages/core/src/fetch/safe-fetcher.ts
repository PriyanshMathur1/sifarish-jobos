import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { type Result, ok, err } from "../result.ts";
import { logger } from "../logger.ts";

/**
 * SafeFetcher — the single seam for ALL external HTTP in ingestion and
 * discovery code (SPEC §2; raw fetch is lint-banned there).
 *
 * Hides: SSRF guard (PRD §108), per-host token-bucket rate limiting,
 * timeouts, retry with exponential backoff + jitter (PRD §98), per-host
 * circuit breaker (PRD §97), and body-size capping. Every dependency with
 * behaviour (dns, fetch, clock, sleep) is injected — tests replace them.
 */

export type ResolveFn = (hostname: string) => Promise<string[]>;

export interface FetchOk {
  status: number;
  headers: Headers;
  body: string;
  finalUrl: string;
}

export type FetchError =
  | { kind: "blocked"; reason: string }
  | { kind: "http"; status: number }
  | { kind: "network"; message: string }
  | { kind: "timeout" }
  | { kind: "breakerOpen"; host: string };

export interface SafeFetcherOptions {
  resolve?: ResolveFn;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRetries?: number;
  maxRedirects?: number;
  ratePerHostPerSec?: number;
  burst?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  userAgent?: string;
}

interface HostState {
  tokens: number;
  lastRefill: number;
  consecutiveFailures: number;
  breakerOpenedAt: number | null;
}

const PRIVATE_V4 = [
  { base: [0, 0, 0, 0], bits: 8 },
  { base: [10, 0, 0, 0], bits: 8 },
  { base: [100, 64, 0, 0], bits: 10 }, // CGNAT
  { base: [127, 0, 0, 0], bits: 8 },
  { base: [169, 254, 0, 0], bits: 16 }, // link-local incl. cloud metadata
  { base: [172, 16, 0, 0], bits: 12 },
  { base: [192, 168, 0, 0], bits: 16 },
];

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)
    ? parts
    : null;
}

function v4IsPrivate(ip: string): boolean {
  const bytes = ipv4ToBytes(ip);
  if (!bytes) return true; // unparseable → treat as unsafe
  const asInt = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return PRIVATE_V4.some(({ base, bits }) => {
    const baseInt = ((base[0]! << 24) | (base[1]! << 16) | (base[2]! << 8) | base[3]!) >>> 0;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (asInt & mask) === (baseInt & mask);
  });
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return v4IsPrivate(ip);
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    )
      return true; // fe80::/10
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
    const mapped = lower.match(/^::ffff:(.+)$/);
    if (mapped) {
      const inner = mapped[1]!;
      return isIP(inner) === 4 ? v4IsPrivate(inner) : true;
    }
    return false;
  }
  return true; // not an IP at all
}

const defaultResolve: ResolveFn = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

export class SafeFetcher {
  private readonly o: Required<
    Omit<SafeFetcherOptions, "resolve" | "fetchImpl" | "sleep" | "now">
  > & {
    resolve: ResolveFn;
    fetchImpl: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
  };
  private hosts = new Map<string, HostState>();
  private robotsCache = new Map<string, string[]>(); // host → disallowed path prefixes for UA *

  constructor(opts: SafeFetcherOptions = {}) {
    this.o = {
      resolve: opts.resolve ?? defaultResolve,
      fetchImpl: opts.fetchImpl ?? fetch,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      now: opts.now ?? Date.now,
      timeoutMs: opts.timeoutMs ?? 15_000,
      maxBodyBytes: opts.maxBodyBytes ?? 10 * 1024 * 1024,
      maxRetries: opts.maxRetries ?? 2,
      maxRedirects: opts.maxRedirects ?? 5,
      ratePerHostPerSec: opts.ratePerHostPerSec ?? 2,
      burst: opts.burst ?? 4,
      breakerThreshold: opts.breakerThreshold ?? 5,
      breakerCooldownMs: opts.breakerCooldownMs ?? 10 * 60 * 1000,
      userAgent: opts.userAgent ?? "SifarishBot/0.1 (+https://sifarish.priyanshmathur.com)",
    };
  }

  async fetch(
    url: string,
    init: { method?: "GET"; headers?: Record<string, string>; respectRobots?: boolean } = {},
  ): Promise<Result<FetchOk, FetchError>> {
    const guarded = await this.guard(url);
    if (!guarded.ok) return guarded;
    const host = new URL(url).hostname;

    // Robots awareness (PRD §23) — opt-in for HTML page crawls (generic
    // provider, contact discovery). First-party JSON APIs skip it.
    if (init.respectRobots) {
      const disallowed = await this.robotsDisallows(url);
      const path = new URL(url).pathname;
      if (disallowed.some((prefix) => prefix !== "" && path.startsWith(prefix))) {
        return err({ kind: "blocked", reason: "disallowed by robots.txt" });
      }
    }

    const state = this.hostState(host);
    if (state.breakerOpenedAt !== null) {
      if (this.o.now() - state.breakerOpenedAt < this.o.breakerCooldownMs) {
        return err({ kind: "breakerOpen", host });
      }
      state.breakerOpenedAt = null; // half-open: allow a probe
      state.consecutiveFailures = 0;
    }

    let attempt = 0;
    for (;;) {
      await this.takeToken(host);
      const result = await this.once(url, init);
      if (result.ok) {
        state.consecutiveFailures = 0;
        return result;
      }
      const retryable =
        result.error.kind === "network" ||
        result.error.kind === "timeout" ||
        (result.error.kind === "http" && [429, 500, 502, 503, 504].includes(result.error.status));
      if (retryable) {
        state.consecutiveFailures++;
        if (state.consecutiveFailures >= this.o.breakerThreshold) {
          state.breakerOpenedAt = this.o.now();
          logger.warn({ host }, "circuit breaker opened");
        }
      }
      if (!retryable || attempt >= this.o.maxRetries) {
        // A non-2xx/3xx that we don't retry is surfaced as http error only if
        // it's a retryable class that exhausted retries; plain 4xx (not 429)
        // is a valid response the caller interprets.
        return result;
      }
      attempt++;
      const backoff = Math.min(30_000, 500 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
      await this.o.sleep(backoff);
    }
  }

  /** One request, redirects followed manually with re-validation per hop. */
  private async once(
    url: string,
    init: { method?: "GET"; headers?: Record<string, string> },
  ): Promise<Result<FetchOk, FetchError>> {
    let current = url;
    for (let hop = 0; hop <= this.o.maxRedirects; hop++) {
      if (hop > 0) {
        const guarded = await this.guard(current);
        if (!guarded.ok) return guarded;
      }
      let res: Response;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
      try {
        res = await this.o.fetchImpl(current, {
          method: init.method ?? "GET",
          headers: { "user-agent": this.o.userAgent, ...init.headers },
          redirect: "manual",
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof Error && e.name === "AbortError") return err({ kind: "timeout" });
        return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
      }
      clearTimeout(timer);

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) return err({ kind: "http", status: res.status });
        current = new URL(location, current).toString();
        continue;
      }
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        return err({ kind: "http", status: res.status });
      }
      const body = await this.readCapped(res);
      return ok({ status: res.status, headers: res.headers, body, finalUrl: current });
    }
    return err({ kind: "blocked", reason: "too many redirects" });
  }

  /**
   * Streaming read with a hard byte cap — the connection is cancelled once
   * the cap is reached, so a hostile 2GB response cannot buffer into memory.
   */
  private async readCapped(res: Response): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received >= this.o.maxBodyBytes) {
        chunks.push(value.slice(0, value.byteLength - (received - this.o.maxBodyBytes)));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder().decode(buf);
  }

  /** Minimal robots.txt: Disallow prefixes under `User-agent: *`, cached per host. */
  private async robotsDisallows(url: string): Promise<string[]> {
    const origin = new URL(url);
    const cached = this.robotsCache.get(origin.hostname);
    if (cached) return cached;
    const rules: string[] = [];
    const res = await this.once(`${origin.protocol}//${origin.host}/robots.txt`, {});
    if (res.ok && res.value.status === 200) {
      let inStar = false;
      for (const line of res.value.body.split("\n")) {
        const [rawKey, ...rest] = line.split(":");
        if (!rawKey || rest.length === 0) continue;
        const key = rawKey.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "user-agent") inStar = value === "*";
        else if (inStar && key === "disallow" && value) rules.push(value);
      }
    }
    // Unreachable robots.txt (or non-200) → no restrictions assumed, per convention.
    this.robotsCache.set(origin.hostname, rules);
    return rules;
  }

  /** SSRF guard: scheme, then EVERY resolved address must be public. */
  private async guard(url: string): Promise<Result<true, FetchError>> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return err({ kind: "blocked", reason: "invalid url" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return err({ kind: "blocked", reason: `scheme ${parsed.protocol}` });
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname)) {
      return isPrivateAddress(hostname)
        ? err({ kind: "blocked", reason: `private address ${hostname}` })
        : ok(true);
    }
    let addresses: string[];
    try {
      addresses = await this.o.resolve(hostname);
    } catch {
      return err({ kind: "network", message: `dns resolution failed for ${hostname}` });
    }
    if (addresses.length === 0)
      return err({ kind: "network", message: `no addresses for ${hostname}` });
    for (const addr of addresses) {
      if (isPrivateAddress(addr)) {
        return err({ kind: "blocked", reason: `resolves to private address ${addr}` });
      }
    }
    return ok(true);
  }

  private hostState(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = {
        tokens: this.o.burst,
        lastRefill: this.o.now(),
        consecutiveFailures: 0,
        breakerOpenedAt: null,
      };
      this.hosts.set(host, s);
    }
    return s;
  }

  /** Token bucket per host; waits (via injected sleep) when empty. */
  private async takeToken(host: string): Promise<void> {
    const s = this.hostState(host);
    const now = this.o.now();
    const elapsed = (now - s.lastRefill) / 1000;
    s.tokens = Math.min(this.o.burst, s.tokens + elapsed * this.o.ratePerHostPerSec);
    s.lastRefill = now;
    if (s.tokens < 1) {
      const waitMs = ((1 - s.tokens) / this.o.ratePerHostPerSec) * 1000;
      await this.o.sleep(waitMs);
      s.tokens = 1;
    }
    s.tokens -= 1;
  }
}
