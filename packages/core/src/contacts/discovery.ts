import type { SafeFetcher } from "../fetch/safe-fetcher.ts";
import { type Result, ok, err } from "../result.ts";
import { extractJsonLdBlocks } from "../providers/generic-jsonld.ts";

/**
 * ContactDiscovery (PRD §66–§69, feature-flagged) — best-effort extraction
 * of PEOPLE from a company's own public pages, strictly conservative:
 * schema.org Person JSON-LD only. No LinkedIn, no login walls, no HTML
 * guessing — a page without structured people data yields zero contacts.
 * Provenance is mandatory on every result.
 */

export interface DiscoveredPerson {
  fullName: string;
  title: string | null;
  email: string | null; // only if the page itself publishes it
  url: string | null;
  sourceUrl: string;
  relevance: number; // 0..1, deterministic (PRD §69)
}

interface JsonLdPerson {
  "@type"?: string | string[];
  name?: string;
  jobTitle?: string;
  email?: string;
  url?: string;
}

function isPerson(node: unknown): node is JsonLdPerson {
  if (typeof node !== "object" || node === null) return false;
  const t = (node as { "@type"?: unknown })["@type"];
  return t === "Person" || (Array.isArray(t) && t.includes("Person"));
}

function collectPeople(node: unknown, out: JsonLdPerson[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectPeople(n, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  if (isPerson(node)) out.push(node);
  for (const key of [
    "@graph",
    "employee",
    "employees",
    "member",
    "members",
    "founder",
    "founders",
  ]) {
    const v = (node as Record<string, unknown>)[key];
    if (v) collectPeople(v, out);
  }
}

/**
 * Deterministic relevance for job-search outreach (PRD §69).
 * Talent/recruiting roles top the list; function leaders next; execs scale
 * inversely with company size (unknown size → middling).
 */
export function contactRelevance(title: string | null, companySizeHint?: number | null): number {
  if (!title) return 0.2;
  const t = title.toLowerCase();
  if (/recruit|talent|people ops|people operations|hr\b|human resources|hiring/.test(t))
    return 0.95;
  if (/founder|ceo|chief executive/.test(t)) {
    if (companySizeHint == null) return 0.5;
    return companySizeHint <= 50 ? 0.85 : 0.15;
  }
  if (/head of|director|vp|vice president|lead/.test(t)) return 0.7;
  if (/manager/.test(t)) return 0.5;
  return 0.3;
}

export async function discoverContacts(
  fetcher: SafeFetcher,
  pageUrl: string,
  opts: { companySizeHint?: number | null } = {},
): Promise<Result<DiscoveredPerson[], { kind: string; detail?: string }>> {
  const res = await fetcher.fetch(pageUrl, { respectRobots: true });
  if (!res.ok) return err({ kind: res.error.kind });
  if (res.value.status !== 200) return err({ kind: "http", detail: String(res.value.status) });

  const people: JsonLdPerson[] = [];
  collectPeople(extractJsonLdBlocks(res.value.body), people);

  const seen = new Set<string>();
  const out: DiscoveredPerson[] = [];
  for (const p of people) {
    const name = p.name?.trim();
    if (!name || name.length < 3 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({
      fullName: name,
      title: p.jobTitle?.trim() ?? null,
      email: p.email?.replace(/^mailto:/, "").trim() || null,
      url: p.url ?? null,
      sourceUrl: pageUrl,
      relevance: contactRelevance(p.jobTitle ?? null, opts.companySizeHint ?? null),
    });
  }
  return ok(out.sort((a, b) => b.relevance - a.relevance));
}
