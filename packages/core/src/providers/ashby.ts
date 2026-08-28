import type { SafeFetcher } from "../fetch/safe-fetcher.ts";
import { type Result, ok, err } from "../result.ts";
import type {
  CompanySource,
  Detection,
  JobProvider,
  NormalizedJob,
  ProviderError,
  ProviderHealth,
  RawJob,
} from "./types.ts";

/**
 * Ashby public posting API (first-party, no auth):
 * https://api.ashbyhq.com/posting-api/job-board/{boardName}?includeCompensation=true
 */

interface AshbyJob {
  id: string;
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  descriptionHtml?: string;
  isRemote?: boolean;
  employmentType?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    compensationTierSummary?: string;
  };
}

export const ashbyProvider: JobProvider = {
  id: "ashby",

  detect({ url, html }): Detection | null {
    const patterns = [/jobs\.ashbyhq\.com\/([a-z0-9-_.%]+)/i];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1])
        return { providerId: "ashby", atsIdentifier: decodeURIComponent(m[1]), confidence: "high" };
    }
    if (html) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1])
          return {
            providerId: "ashby",
            atsIdentifier: decodeURIComponent(m[1]),
            confidence: "medium",
          };
      }
    }
    return null;
  },

  async listJobs(
    fetcher: SafeFetcher,
    src: CompanySource,
  ): Promise<Result<RawJob[], ProviderError>> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(src.atsIdentifier)}?includeCompensation=true`;
    const res = await fetcher.fetch(url);
    if (!res.ok) return err({ kind: "unreachable", detail: JSON.stringify(res.error) });
    if (res.value.status === 404) return err({ kind: "notFound" });
    if (res.value.status !== 200)
      return err({ kind: "unreachable", detail: `http ${res.value.status}` });
    try {
      const data = JSON.parse(res.value.body) as { jobs?: AshbyJob[] };
      if (!Array.isArray(data.jobs)) return err({ kind: "parseError", detail: "no jobs array" });
      return ok(data.jobs.filter((j) => j && j.id).map((j) => ({ externalId: j.id, payload: j })));
    } catch (e) {
      return err({ kind: "parseError", detail: e instanceof Error ? e.message : String(e) });
    }
  },

  normalize(raw: RawJob): NormalizedJob {
    const j = raw.payload as AshbyJob;
    const locations: string[] = [];
    if (j.location) locations.push(j.location);
    for (const s of j.secondaryLocations ?? []) {
      if (s.location && !locations.includes(s.location)) locations.push(s.location);
    }
    const d = j.publishedAt ? new Date(j.publishedAt) : null;
    return {
      externalId: raw.externalId,
      title: j.title?.trim() ?? "",
      descriptionHtml: j.descriptionHtml ?? null,
      locations,
      remoteType: j.isRemote === true ? "remote" : null,
      employmentType: j.employmentType ?? null,
      sourcePostedAt: d && !Number.isNaN(d.getTime()) ? d : null,
      sourceUpdatedAt: null,
      applyUrl: j.applyUrl ?? j.jobUrl ?? null,
      sourceUrl: j.jobUrl ?? null,
      salary: null, // compensation tier summaries are prose; never parsed into fake ranges
    };
  },

  async healthCheck(fetcher: SafeFetcher, src: CompanySource): Promise<ProviderHealth> {
    const res = await this.listJobs(fetcher, src);
    return res.ok ? { ok: true } : { ok: false, detail: res.error.kind };
  },
};
