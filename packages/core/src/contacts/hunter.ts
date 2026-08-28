/**
 * HunterClient — thin wrapper over Hunter.io's Email Finder + Email Verifier
 * endpoints (free tier: ~25 searches/month). Deliberately narrow scope:
 *
 *   - single-contact lookups only (one name+domain, or one candidate email
 *     at a time) — never domain-search/bulk endpoints, which would burn the
 *     free quota in one call and drift toward the bulk people-search this
 *     project explicitly declined to build (SPEC §0 G4: no paid APIs, no
 *     bulk discovery — pattern engine + validation is the real leverage).
 *   - results are third-party inference, not an OBSERVED address. They are
 *     therefore capped at HIGH_CONFIDENCE and can never produce VERIFIED —
 *     the same invariant EmailValidator enforces for our own pattern engine.
 *
 * No network calls happen unless HUNTER_API_KEY is configured; callers
 * should treat a missing key as "feature unavailable", not an error.
 */

export type HunterOutcome =
  | { kind: "found"; email: string; status: "HIGH_CONFIDENCE" | "PROBABLE" | "UNKNOWN" }
  | { kind: "not_found" }
  | { kind: "invalid" }
  | { kind: "quota_exceeded" }
  | { kind: "error"; detail: string };

interface FinderResponse {
  data?: {
    email?: string | null;
    score?: number | null;
    verification?: { status?: string | null } | null;
  } | null;
  errors?: Array<{ id?: string; details?: string }>;
}

interface VerifierResponse {
  data?: {
    status?: string | null; // valid | invalid | accept_all | webmail | disposable | unknown
    result?: string | null; // deliverable | undeliverable | risky
    score?: number | null;
  } | null;
  errors?: Array<{ id?: string; details?: string }>;
}

function classifyFinder(body: FinderResponse): HunterOutcome {
  const d = body.data;
  if (!d?.email) return { kind: "not_found" };
  const verifStatus = d.verification?.status ?? null;
  const score = d.score ?? 0;
  if (verifStatus === "invalid") return { kind: "invalid" };
  if (verifStatus === "valid" && score >= 85) {
    return { kind: "found", email: d.email, status: "HIGH_CONFIDENCE" };
  }
  if (score >= 50) return { kind: "found", email: d.email, status: "PROBABLE" };
  return { kind: "found", email: d.email, status: "UNKNOWN" };
}

function classifyVerifier(body: VerifierResponse): HunterOutcome {
  const d = body.data;
  if (!d) return { kind: "error", detail: "empty response" };
  // email is filled in by the caller (verifyEmail), which already knows it.
  if (d.result === "undeliverable" || d.status === "invalid") return { kind: "invalid" };
  if (d.result === "deliverable" && d.status === "valid" && (d.score ?? 0) >= 85) {
    return { kind: "found", email: "", status: "HIGH_CONFIDENCE" };
  }
  if (d.result === "risky" || (d.score ?? 0) >= 50) {
    return { kind: "found", email: "", status: "PROBABLE" };
  }
  return { kind: "found", email: "", status: "UNKNOWN" };
}

export class HunterClient {
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
    private base = "https://api.hunter.io/v2",
  ) {}

  private async call(url: string): Promise<{ status: number; body: unknown } | { error: string }> {
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "network error" };
    }
  }

  /** Find a single person's likely email at `domain`. One credit on success. */
  async findEmail(input: {
    domain: string;
    firstName: string;
    lastName: string;
  }): Promise<HunterOutcome> {
    const url = `${this.base}/email-finder?domain=${encodeURIComponent(input.domain)}&first_name=${encodeURIComponent(input.firstName)}&last_name=${encodeURIComponent(input.lastName)}&api_key=${this.apiKey}`;
    const res = await this.call(url);
    if ("error" in res) return { kind: "error", detail: res.error };
    if (res.status === 429) return { kind: "quota_exceeded" };
    if (res.status === 401 || res.status === 403) return { kind: "error", detail: "auth" };
    if (res.status >= 500) return { kind: "error", detail: `hunter ${res.status}` };
    return classifyFinder(res.body as FinderResponse);
  }

  /** Verify deliverability of a specific candidate email. One credit on success. */
  async verifyEmail(email: string): Promise<HunterOutcome> {
    const url = `${this.base}/email-verifier?email=${encodeURIComponent(email)}&api_key=${this.apiKey}`;
    const res = await this.call(url);
    if ("error" in res) return { kind: "error", detail: res.error };
    if (res.status === 429) return { kind: "quota_exceeded" };
    if (res.status === 401 || res.status === 403) return { kind: "error", detail: "auth" };
    if (res.status >= 500) return { kind: "error", detail: `hunter ${res.status}` };
    const outcome = classifyVerifier(res.body as VerifierResponse);
    return outcome.kind === "found" ? { ...outcome, email } : outcome;
  }
}
