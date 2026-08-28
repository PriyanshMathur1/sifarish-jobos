import {
  AMBIGUOUS_SKILLS,
  CITY_SEEDS,
  COUNTRY_SEEDS,
  SENIORITY_MARKERS,
  SKILL_ALIASES,
  TITLE_MODIFIERS,
  TITLE_SEEDS,
} from "./seeds.ts";

/**
 * Taxonomy — normalization for locations, titles, skills (PRD §36–38).
 * Pure functions over seed data. Aliases relate; they don't merge:
 * `normalizeTitle` keeps modifiers so similarity can distinguish
 * "Growth Product Manager" from plain "Product Manager".
 * Never fabricates: unknown inputs come back marked unknown, raw preserved.
 */

export interface LocationNorm {
  raw: string;
  city?: string;
  country?: string; // ISO alpha-2 (or region pseudo-code like APAC)
  kind: "city" | "country" | "remote" | "unknown";
}

const cityByAlias = new Map<string, { city: string; country: string }>();
for (const seed of CITY_SEEDS) {
  for (const a of seed.aliases) cityByAlias.set(a, { city: seed.city, country: seed.country });
}

function findCountry(text: string): string | undefined {
  const t = text.toLowerCase();
  for (const [name, code] of Object.entries(COUNTRY_SEEDS)) {
    if (new RegExp(`(^|[^a-z])${name}([^a-z]|$)`, "i").test(t)) return code;
  }
  return undefined;
}

export function normalizeLocation(raw: string): LocationNorm {
  const cleaned = raw.trim();
  const lower = cleaned.toLowerCase();

  const isRemote = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b|\bdistributed\b/i.test(
    lower,
  );

  // City match on comma-separated segments and the full string
  const segments = lower
    .split(/[,/|·]| - |\(|\)/)
    .map((s) => s.trim())
    .filter(Boolean);
  let cityHit: { city: string; country: string } | undefined;
  for (const seg of [lower, ...segments]) {
    const hit = cityByAlias.get(seg);
    if (hit) {
      cityHit = hit;
      break;
    }
  }

  const country = cityHit?.country ?? findCountry(lower);

  if (isRemote) {
    return {
      raw: cleaned,
      kind: "remote",
      ...(cityHit ? { city: cityHit.city } : {}),
      ...(country ? { country } : {}),
    };
  }
  if (cityHit) return { raw: cleaned, kind: "city", city: cityHit.city, country: cityHit.country };
  if (country) return { raw: cleaned, kind: "country", country };
  return { raw: cleaned, kind: "unknown" };
}

export interface TitleNorm {
  raw: string;
  canonical: string;
  function: string | null;
  modifiers: string[];
}

const titleByAlias: Array<{ alias: string; canonical: string; fn: string }> = [];
for (const seed of TITLE_SEEDS) {
  for (const a of seed.aliases)
    titleByAlias.push({ alias: a, canonical: seed.canonical, fn: seed.function });
}
// Longest aliases first so "product manager" wins over "pm"
titleByAlias.sort((a, b) => b.alias.length - a.alias.length);

function stripNoise(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bsr\.?\b|\bsenior\b|\bjr\.?\b|\bjunior\b|\bstaff\b|\bprincipal\b|\blead\b/g, " ")
    .replace(/\bvp,?\s*(of\s*)?|vice president,?\s*(of\s*)?/g, " ")
    .replace(/\bdirector,?\s*(of\s*)?|\bhead of\b/g, " ")
    .replace(/\b(i{1,3}|iv|v|1|2|3|4|5)\b\s*$/g, " ")
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(raw: string): TitleNorm {
  const stripped = stripNoise(raw);
  const modifiers = TITLE_MODIFIERS.filter((m) =>
    new RegExp(`(^|[^a-z])${m}([^a-z]|$)`).test(stripped),
  );

  for (const { alias, canonical, fn } of titleByAlias) {
    if (
      new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(
        stripped,
      )
    ) {
      return { raw, canonical, function: fn, modifiers };
    }
  }
  // Unknown title family: canonical is the cleaned raw — never invented.
  return { raw, canonical: raw.trim(), function: null, modifiers };
}

export type Seniority =
  "intern" | "entry" | "mid" | "senior" | "lead" | "manager" | "director" | "vp" | "executive";

export function seniorityOf(title: string): Seniority {
  for (const { level, patterns } of SENIORITY_MARKERS) {
    if (patterns.some((p) => p.test(title))) return level as Seniority;
  }
  return "mid";
}

export function normalizeSkill(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (AMBIGUOUS_SKILLS.has(key)) return raw.trim(); // context-dependent: leave as-is (PRD §37)
  return SKILL_ALIASES[key] ?? raw.trim();
}

/**
 * Title similarity in [0,1]: canonical family match dominates, shared
 * modifiers push toward 1, token overlap covers unknown families.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);

  if (na.canonical === nb.canonical) {
    const am = new Set(na.modifiers);
    const bm = new Set(nb.modifiers);
    if (am.size === 0 && bm.size === 0) return 0.85;
    const shared = [...am].filter((m) => bm.has(m)).length;
    const total = new Set([...am, ...bm]).size;
    return total === 0 ? 0.85 : 0.8 + 0.2 * (shared / total);
  }

  // Different (or unknown) families: token Jaccard on cleaned strings.
  const tokens = (s: string) =>
    new Set(
      stripNoise(s)
        .split(" ")
        .filter((t) => t.length > 1),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return (inter / union) * 0.6; // capped: cross-family can't beat same-family
}
