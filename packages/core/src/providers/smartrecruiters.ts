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
 * SmartRecruiters Posting API (public, no auth):
 * list:   https://api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset=N
 * detail: https://api.smartrecruiters.com/v1/companies/{id}/postings/{postingId}
 * The list carries no description, so listJobs fetches details (capped) and
 * merges them into the payload; normalize stays pure.
 */

interface SrPosting {
  id: string;
  uuid?: string;
  name?: string;
  refNumber?: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string };
  typeOfEmployment?: { label?: string };
  department?: { label?: string };
  ref?: string;
  applyUrl?: string;
  postingUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
}

const MAX_DETAILS = 150;

export const smartrecruitersProvider: JobProvider = {
  id: "smartrecruiters",

  detect({ url, html }): Detection | null {
    const patterns = [/jobs\.smartrecruiters\.com\/([A-Za-z0-9]+)/, /careers\.smartrecruiters\.com\/([A-Za-z0-9]+)/, /api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9]+)/];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1]) return { providerId: "smartrecruiters", atsIdentifier: m[1], confidence: "high" };
    }
    if (html) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1]) return { providerId: "smartrecruiters", atsIdentifier: m[1], confidence: "medium" };
      }
    }
    return null;
  },

  async listJobs(fetcher: SafeFetcher, src: CompanySource): Promise<Result<RawJob[], ProviderError>> {
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(src.atsIdentifier)}/postings`;
    const all: SrPosting[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const res = await fetcher.fetch(`${base}?limit=100&offset=${offset}`);
      if (!res.ok) return err({ kind: "unreachable", detail: JSON.stringify(res.error) });
      if (res.value.status === 404) return err({ kind: "notFound" });
      if (res.value.status !== 200) return err({ kind: "unreachable", detail: `http ${res.value.status}` });
      let page: { content?: SrPosting[]; totalFound?: number };
      try {
        page = JSON.parse(res.value.body) as { content?: SrPosting[]; totalFound?: number };
      } catch (e) {
        return err({ kind: "parseError", detail: e instanceof Error ? e.message : String(e) });
      }
      if (!Array.isArray(page.content)) return err({ kind: "parseError", detail: "expected content array" });
      all.push(...page.content.filter((p) => p && p.id));
      if (page.content.length < 100 || all.length >= (page.totalFound ?? Infinity)) break;
    }
    // Details for the description (best effort; a failed detail keeps the listing without one).
    for (const p of all.slice(0, MAX_DETAILS)) {
      const d = await fetcher.fetch(`${base}/${encodeURIComponent(p.id)}`);
      if (d.ok && d.value.status === 200) {
        try {
          const detail = JSON.parse(d.value.body) as SrPosting;
          if (detail.jobAd) p.jobAd = detail.jobAd;
          if (detail.applyUrl) p.applyUrl = detail.applyUrl;
          if (detail.postingUrl) p.postingUrl = detail.postingUrl;
        } catch {
          /* keep listing-only payload */
        }
      }
    }
    return ok(all.map((p) => ({ externalId: p.id, payload: p })));
  },

  normalize(raw: RawJob): NormalizedJob {
    const p = raw.payload as SrPosting & { companyIdentifier?: string };
    const loc = p.location;
    const full = loc?.fullLocation || [loc?.city, loc?.region, loc?.country].filter(Boolean).join(", ");
    const sections = p.jobAd?.sections ?? {};
    const html = Object.values(sections)
      .filter((s) => s?.text)
      .map((s) => (s.title ? `<h3>${s.title}</h3>${s.text}` : s.text))
      .join("\n");
    return {
      externalId: raw.externalId,
      title: p.name?.trim() ?? "",
      descriptionHtml: html || null,
      locations: full ? [full] : [],
      remoteType: loc?.remote ? "remote" : null,
      employmentType: p.typeOfEmployment?.label ?? null,
      sourcePostedAt: p.releasedDate ? new Date(p.releasedDate) : null,
      sourceUpdatedAt: null,
      applyUrl: p.applyUrl ?? p.postingUrl ?? null,
      sourceUrl: p.postingUrl ?? null,
      salary: null,
    };
  },

  async healthCheck(fetcher: SafeFetcher, src: CompanySource): Promise<ProviderHealth> {
    const res = await fetcher.fetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(src.atsIdentifier)}/postings?limit=1`);
    return res.ok && res.value.status === 200 ? { ok: true } : { ok: false, detail: res.ok ? `http ${res.value.status}` : res.error.kind };
  },
};
