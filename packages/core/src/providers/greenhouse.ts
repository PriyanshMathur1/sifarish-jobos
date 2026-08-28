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
 * Greenhouse Job Board API (public, first-party, no auth):
 * https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 */

interface GhJob {
  id: number;
  title?: string;
  content?: string;
  absolute_url?: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  offices?: Array<{ name?: string; location?: string }>;
  metadata?: unknown;
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Greenhouse embeds HTML-escaped content; unescape the standard entities. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export const greenhouseProvider: JobProvider = {
  id: "greenhouse",

  detect({ url, html }): Detection | null {
    const patterns = [
      /boards\.greenhouse\.io\/([a-z0-9-_]+)/i,
      /job-boards\.greenhouse\.io\/([a-z0-9-_]+)/i,
      /boards\.eu\.greenhouse\.io\/([a-z0-9-_]+)/i,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m?.[1]) return { providerId: "greenhouse", atsIdentifier: m[1], confidence: "high" };
    }
    if (html) {
      for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1]) return { providerId: "greenhouse", atsIdentifier: m[1], confidence: "medium" };
      }
    }
    return null;
  },

  async listJobs(
    fetcher: SafeFetcher,
    src: CompanySource,
  ): Promise<Result<RawJob[], ProviderError>> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(src.atsIdentifier)}/jobs?content=true`;
    const res = await fetcher.fetch(url);
    if (!res.ok) return err({ kind: "unreachable", detail: JSON.stringify(res.error) });
    if (res.value.status === 404) return err({ kind: "notFound" });
    if (res.value.status !== 200)
      return err({ kind: "unreachable", detail: `http ${res.value.status}` });
    try {
      const data = JSON.parse(res.value.body) as { jobs?: GhJob[] };
      if (!Array.isArray(data.jobs)) return err({ kind: "parseError", detail: "no jobs array" });
      return ok(
        data.jobs
          .filter((j) => j && j.id != null)
          .map((j) => ({ externalId: String(j.id), payload: j })),
      );
    } catch (e) {
      return err({ kind: "parseError", detail: e instanceof Error ? e.message : String(e) });
    }
  },

  normalize(raw: RawJob): NormalizedJob {
    const j = raw.payload as GhJob;
    const locations: string[] = [];
    if (j.location?.name) locations.push(j.location.name);
    for (const office of j.offices ?? []) {
      if (office.name && !locations.includes(office.name)) locations.push(office.name);
    }
    const remoteType = locations.some((l) => /remote/i.test(l)) ? ("remote" as const) : null;
    return {
      externalId: raw.externalId,
      title: j.title?.trim() ?? "",
      descriptionHtml: j.content ? unescapeHtml(j.content) : null,
      locations,
      remoteType,
      employmentType: null, // greenhouse boards API does not state it — never guessed
      sourcePostedAt: parseDate(j.first_published),
      sourceUpdatedAt: parseDate(j.updated_at),
      applyUrl: j.absolute_url ?? null,
      sourceUrl: j.absolute_url ?? null,
      salary: null,
    };
  },

  async healthCheck(fetcher: SafeFetcher, src: CompanySource): Promise<ProviderHealth> {
    const res = await this.listJobs(fetcher, src);
    return res.ok ? { ok: true } : { ok: false, detail: res.error.kind };
  },
};
