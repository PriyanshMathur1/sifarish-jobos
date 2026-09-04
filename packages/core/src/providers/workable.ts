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
 * Workable public accounts API (first-party, no auth, published for embedding):
 * https://www.workable.com/api/accounts/{subdomain}?details=true
 * Common with Indian startups. Descriptions come back as HTML.
 */

interface WorkableJob {
  title?: string;
  shortcode: string;
  code?: string;
  country?: string;
  city?: string;
  state?: string;
  telecommuting?: boolean;
  department?: string;
  employment_type?: string;
  published_on?: string; // YYYY-MM-DD
  created_at?: string;
  url?: string;
  application_url?: string;
  shortlink?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
  locations?: Array<{ city?: string; country?: string; region?: string; workplaceType?: string }>;
}

export const workableProvider: JobProvider = {
  id: "workable",

  detect({ url, html }): Detection | null {
    const patterns = [/apply\.workable\.com\/([a-z0-9-]+)/i, /https?:\/\/([a-z0-9-]+)\.workable\.com/i];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1] && m[1] !== "www" && m[1] !== "apply") return { providerId: "workable", atsIdentifier: m[1].toLowerCase(), confidence: "high" };
    }
    if (html) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1] && m[1] !== "www" && m[1] !== "apply") return { providerId: "workable", atsIdentifier: m[1].toLowerCase(), confidence: "medium" };
      }
    }
    return null;
  },

  async listJobs(fetcher: SafeFetcher, src: CompanySource): Promise<Result<RawJob[], ProviderError>> {
    const url = `https://www.workable.com/api/accounts/${encodeURIComponent(src.atsIdentifier)}?details=true`;
    const res = await fetcher.fetch(url);
    if (!res.ok) return err({ kind: "unreachable", detail: JSON.stringify(res.error) });
    if (res.value.status === 404) return err({ kind: "notFound" });
    if (res.value.status !== 200) return err({ kind: "unreachable", detail: `http ${res.value.status}` });
    try {
      const data = JSON.parse(res.value.body) as { jobs?: WorkableJob[] };
      if (!Array.isArray(data.jobs)) return err({ kind: "parseError", detail: "expected jobs array" });
      return ok(data.jobs.filter((j) => j && j.shortcode).map((j) => ({ externalId: j.shortcode, payload: j })));
    } catch (e) {
      return err({ kind: "parseError", detail: e instanceof Error ? e.message : String(e) });
    }
  },

  normalize(raw: RawJob): NormalizedJob {
    const j = raw.payload as WorkableJob;
    const locs = (j.locations ?? [])
      .map((l) => [l.city, l.region, l.country].filter(Boolean).join(", "))
      .filter(Boolean);
    const single = [j.city, j.state, j.country].filter(Boolean).join(", ");
    const locations = locs.length ? locs : single ? [single] : [];
    const wp = (j.locations ?? []).map((l) => (l.workplaceType ?? "").toLowerCase());
    const remoteType: NormalizedJob["remoteType"] = j.telecommuting || wp.includes("remote") ? "remote" : wp.includes("hybrid") ? "hybrid" : wp.includes("on_site") || wp.includes("onsite") ? "onsite" : null;
    const html = [j.description, j.requirements ? `<h3>Requirements</h3>${j.requirements}` : "", j.benefits ? `<h3>Benefits</h3>${j.benefits}` : ""].filter(Boolean).join("\n");
    return {
      externalId: raw.externalId,
      title: j.title?.trim() ?? "",
      descriptionHtml: html || null,
      locations,
      remoteType,
      employmentType: j.employment_type ?? null,
      sourcePostedAt: j.published_on ? new Date(`${j.published_on}T00:00:00Z`) : j.created_at ? new Date(j.created_at) : null,
      sourceUpdatedAt: null,
      applyUrl: j.application_url ?? j.url ?? null,
      sourceUrl: j.url ?? j.shortlink ?? null,
      salary: null,
    };
  },

  async healthCheck(fetcher: SafeFetcher, src: CompanySource): Promise<ProviderHealth> {
    const res = await this.listJobs(fetcher, src);
    return res.ok ? { ok: true } : { ok: false, detail: res.error.kind };
  },
};
