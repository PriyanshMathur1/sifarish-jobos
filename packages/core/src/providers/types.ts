import type { SafeFetcher } from "../fetch/safe-fetcher.ts";
import type { Result } from "../result.ts";

/**
 * JobProvider seam (PRD §20) — every job source sits behind this interface.
 * `normalize` is PURE (no I/O) so contract tests run entirely on fixtures.
 * Providers receive SafeFetcher; they never construct their own HTTP client.
 */

export type ProviderId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "generic-jsonld";

export interface CompanySource {
  /** Provider-specific board identifier (e.g. greenhouse board token). */
  atsIdentifier: string;
  /** The careers URL as known — generic provider fetches this directly. */
  careersUrl?: string;
}

export interface Detection {
  providerId: ProviderId;
  atsIdentifier: string;
  confidence: "high" | "medium" | "low";
}

/** Raw payload as the source returned it — stored verbatim in versions. */
export interface RawJob {
  externalId: string;
  payload: unknown;
}

export interface NormalizedJob {
  externalId: string;
  title: string;
  descriptionHtml: string | null;
  /** Location strings exactly as the source states them. */
  locations: string[];
  remoteType: "remote" | "hybrid" | "onsite" | null;
  employmentType: string | null;
  /** Source-provided timestamps only — never fabricated (PRD §34). */
  sourcePostedAt: Date | null;
  sourceUpdatedAt: Date | null;
  applyUrl: string | null;
  sourceUrl: string | null;
  salary: { min: number; max: number; currency: string; period: string } | null;
}

export type ProviderError =
  | { kind: "unreachable"; detail: string }
  | { kind: "notFound" }
  | { kind: "parseError"; detail: string }
  | { kind: "blocked"; detail: string };

export interface ProviderHealth {
  ok: boolean;
  detail?: string;
}

export interface JobProvider {
  id: ProviderId;
  /** Given a careers URL (+ optionally page HTML), detect this provider. */
  detect(input: { url: string; html?: string }): Detection | null;
  listJobs(fetcher: SafeFetcher, src: CompanySource): Promise<Result<RawJob[], ProviderError>>;
  /** Pure. Throws never; unparseable fields become null — never fabricated. */
  normalize(raw: RawJob): NormalizedJob;
  healthCheck(fetcher: SafeFetcher, src: CompanySource): Promise<ProviderHealth>;
}
