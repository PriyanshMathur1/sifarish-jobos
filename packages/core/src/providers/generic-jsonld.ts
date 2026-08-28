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
 * Generic careers-page provider — STRICT schema.org/JobPosting JSON-LD only
 * (grill G11, PRD §22). No speculative HTML scraping; a page without JSON-LD
 * yields zero jobs. Never fabricates fields.
 */

interface JsonLdJobPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  identifier?: { value?: string } | string;
  datePosted?: string;
  employmentType?: string | string[];
  jobLocation?: JsonLdPlace | JsonLdPlace[];
  jobLocationType?: string;
  applicantLocationRequirements?: { name?: string } | Array<{ name?: string }>;
  baseSalary?: {
    currency?: string;
    value?: { minValue?: number; maxValue?: number; unitText?: string };
  };
  url?: string;
  directApply?: boolean;
}

interface JsonLdPlace {
  address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } | string;
}

function isJobPosting(node: unknown): node is JsonLdJobPosting {
  if (typeof node !== "object" || node === null) return false;
  const t = (node as { "@type"?: unknown })["@type"];
  return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
}

/** Walk any JSON-LD structure (incl. @graph) collecting JobPosting nodes. */
function collectPostings(node: unknown, out: JsonLdJobPosting[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectPostings(n, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  if (isJobPosting(node)) out.push(node);
  const graph = (node as { "@graph"?: unknown })["@graph"];
  if (graph) collectPostings(graph, out);
}

export function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1]!.trim()));
    } catch {
      // malformed block: skipped, never guessed at
    }
  }
  return blocks;
}

function placeToString(p: JsonLdPlace): string | null {
  const a = p.address;
  if (!a) return null;
  if (typeof a === "string") return a;
  const parts = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export const genericJsonLdProvider: JobProvider = {
  id: "generic-jsonld",

  detect({ html }): Detection | null {
    if (!html) return null;
    const blocks = extractJsonLdBlocks(html);
    const postings: JsonLdJobPosting[] = [];
    collectPostings(blocks, postings);
    return postings.length > 0
      ? { providerId: "generic-jsonld", atsIdentifier: "jsonld", confidence: "medium" }
      : null;
  },

  async listJobs(
    fetcher: SafeFetcher,
    src: CompanySource,
  ): Promise<Result<RawJob[], ProviderError>> {
    if (!src.careersUrl) return err({ kind: "notFound" });
    const res = await fetcher.fetch(src.careersUrl);
    if (!res.ok) return err({ kind: "unreachable", detail: JSON.stringify(res.error) });
    if (res.value.status !== 200)
      return err({ kind: "unreachable", detail: `http ${res.value.status}` });
    const postings: JsonLdJobPosting[] = [];
    collectPostings(extractJsonLdBlocks(res.value.body), postings);
    return ok(
      postings.map((p, i) => {
        const identifier = typeof p.identifier === "object" ? p.identifier?.value : p.identifier;
        // A stable external id from the source where possible; else url; else
        // position-derived (weak, but versions hash-compare anyway).
        const externalId = identifier || p.url || `${src.careersUrl}#${i}`;
        return { externalId: String(externalId), payload: p };
      }),
    );
  },

  normalize(raw: RawJob): NormalizedJob {
    const p = raw.payload as JsonLdJobPosting;
    const places = Array.isArray(p.jobLocation)
      ? p.jobLocation
      : p.jobLocation
        ? [p.jobLocation]
        : [];
    const locations = places.map(placeToString).filter((x): x is string => Boolean(x));
    const remoteType = p.jobLocationType === "TELECOMMUTE" ? ("remote" as const) : null;
    const alr = Array.isArray(p.applicantLocationRequirements)
      ? p.applicantLocationRequirements
      : p.applicantLocationRequirements
        ? [p.applicantLocationRequirements]
        : [];
    for (const req of alr) {
      if (req.name && !locations.includes(req.name)) locations.push(`Remote - ${req.name}`);
    }
    const employmentType = Array.isArray(p.employmentType)
      ? (p.employmentType[0] ?? null)
      : (p.employmentType ?? null);
    const posted = p.datePosted ? new Date(p.datePosted) : null;
    const salary =
      p.baseSalary?.value?.minValue != null && p.baseSalary?.value?.maxValue != null
        ? {
            min: p.baseSalary.value.minValue,
            max: p.baseSalary.value.maxValue,
            currency: p.baseSalary.currency ?? "",
            period: p.baseSalary.value.unitText ?? "",
          }
        : null;
    return {
      externalId: raw.externalId,
      title: p.title?.trim() ?? "",
      descriptionHtml: p.description ?? null,
      locations,
      remoteType,
      employmentType,
      sourcePostedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
      sourceUpdatedAt: null,
      applyUrl: p.url ?? null,
      sourceUrl: p.url ?? null,
      salary,
    };
  },

  async healthCheck(fetcher: SafeFetcher, src: CompanySource): Promise<ProviderHealth> {
    const res = await this.listJobs(fetcher, src);
    return res.ok ? { ok: true } : { ok: false, detail: res.error.kind };
  },
};
