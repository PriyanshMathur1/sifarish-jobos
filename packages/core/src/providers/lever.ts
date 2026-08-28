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
 * Lever Postings API (public, first-party, no auth):
 * https://api.lever.co/v0/postings/{site}?mode=json
 */

interface LeverPosting {
  id: string;
  text?: string; // title
  descriptionPlain?: string;
  description?: string; // html
  lists?: Array<{ text?: string; content?: string }>;
  categories?: {
    location?: string;
    allLocations?: string[];
    commitment?: string;
    team?: string;
    department?: string;
  };
  workplaceType?: string; // "remote" | "hybrid" | "on-site" | "onsite" | "unspecified"
  createdAt?: number; // epoch ms
  hostedUrl?: string;
  applyUrl?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

function mapWorkplace(w: string | undefined): NormalizedJob["remoteType"] {
  if (!w) return null;
  const t = w.toLowerCase();
  if (t === "remote") return "remote";
  if (t === "hybrid") return "hybrid";
  if (t === "on-site" || t === "onsite") return "onsite";
  return null;
}

export const leverProvider: JobProvider = {
  id: "lever",

  detect({ url, html }): Detection | null {
    const patterns = [/jobs\.lever\.co\/([a-z0-9-_]+)/i, /jobs\.eu\.lever\.co\/([a-z0-9-_]+)/i];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1]) return { providerId: "lever", atsIdentifier: m[1], confidence: "high" };
    }
    if (html) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1]) return { providerId: "lever", atsIdentifier: m[1], confidence: "medium" };
      }
    }
    return null;
  },

  async listJobs(
    fetcher: SafeFetcher,
    src: CompanySource,
  ): Promise<Result<RawJob[], ProviderError>> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(src.atsIdentifier)}?mode=json`;
    const res = await fetcher.fetch(url);
    if (!res.ok) return err({ kind: "unreachable", detail: JSON.stringify(res.error) });
    if (res.value.status === 404) return err({ kind: "notFound" });
    if (res.value.status !== 200)
      return err({ kind: "unreachable", detail: `http ${res.value.status}` });
    try {
      const data = JSON.parse(res.value.body) as LeverPosting[];
      if (!Array.isArray(data)) return err({ kind: "parseError", detail: "expected array" });
      return ok(data.filter((p) => p && p.id).map((p) => ({ externalId: p.id, payload: p })));
    } catch (e) {
      return err({ kind: "parseError", detail: e instanceof Error ? e.message : String(e) });
    }
  },

  normalize(raw: RawJob): NormalizedJob {
    const p = raw.payload as LeverPosting;
    const locations = p.categories?.allLocations?.length
      ? p.categories.allLocations
      : p.categories?.location
        ? [p.categories.location]
        : [];
    const salary =
      p.salaryRange?.min != null && p.salaryRange?.max != null
        ? {
            min: p.salaryRange.min,
            max: p.salaryRange.max,
            currency: p.salaryRange.currency ?? "USD",
            period: p.salaryRange.interval ?? "per-year-salary",
          }
        : null;
    return {
      externalId: raw.externalId,
      title: p.text?.trim() ?? "",
      descriptionHtml: p.description ?? null,
      locations,
      remoteType: mapWorkplace(p.workplaceType),
      employmentType: p.categories?.commitment ?? null,
      sourcePostedAt: p.createdAt ? new Date(p.createdAt) : null,
      sourceUpdatedAt: null, // lever postings API doesn't expose it
      applyUrl: p.applyUrl ?? p.hostedUrl ?? null,
      sourceUrl: p.hostedUrl ?? null,
      salary,
    };
  },

  async healthCheck(fetcher: SafeFetcher, src: CompanySource): Promise<ProviderHealth> {
    const res = await this.listJobs(fetcher, src);
    return res.ok ? { ok: true } : { ok: false, detail: res.error.kind };
  },
};
