/**
 * PatternEngine (SPEC §2) — pure email-pattern inference.
 *
 * Hides: name parsing (diacritics, middle names, punctuation), the pattern
 * library, learned-pattern ranking, and the PRD §70 generation step.
 * Never invents a domain; generated guesses are capped at low confidence —
 * only observation can raise it (PRD §73: inferred ≠ verified).
 */

export interface ParsedName {
  first: string;
  last: string;
}

/** Strip diacritics + punctuation, lowercase. */
function cleanToken(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function parseName(fullName: string): ParsedName {
  const parts = fullName.trim().split(/\s+/).map(cleanToken).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

/** Pattern library, ordered by real-world prevalence. */
export const PATTERNS = [
  "first.last",
  "first",
  "flast",
  "firstlast",
  "first_last",
  "firstl",
  "f.last",
  "last.first",
  "lastf",
] as const;
export type Pattern = (typeof PATTERNS)[number] | string;

export function applyPattern(pattern: Pattern, name: ParsedName, domain: string): string | null {
  const { first, last } = name;
  const f = first.charAt(0);
  const l = last.charAt(0);
  const local = (() => {
    switch (pattern) {
      case "first.last":
        return first && last ? `${first}.${last}` : null;
      case "first":
        return first || null;
      case "flast":
        return f && last ? `${f}${last}` : null;
      case "firstlast":
        return first && last ? `${first}${last}` : null;
      case "first_last":
        return first && last ? `${first}_${last}` : null;
      case "firstl":
        return first && l ? `${first}${l}` : null;
      case "f.last":
        return f && last ? `${f}.${last}` : null;
      case "last.first":
        return first && last ? `${last}.${first}` : null;
      case "lastf":
        return last && f ? `${last}${f}` : null;
      default:
        return null;
    }
  })();
  return local ? `${local}@${domain}` : null;
}

/**
 * Learn which pattern explains a VERIFIED (fullName, email) observation.
 * Returns null when nothing in the library explains it — never guesses.
 */
export function learnPattern(fullName: string, email: string): Pattern | null {
  const at = email.indexOf("@");
  if (at <= 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const name = parseName(fullName);
  for (const p of PATTERNS) {
    if (applyPattern(p, name, domain)?.toLowerCase() === email.toLowerCase()) return p;
  }
  return null;
}

export interface EmailCandidate {
  email: string;
  pattern: Pattern;
  confidence: number; // 0..1 — generated guesses are ≤ 0.5 by construction
  basis: "company_pattern" | "generated";
}

export interface CompanyPatternKnowledge {
  domain: string | null;
  learnedPatterns: Array<{ pattern: Pattern; confidence: number; evidenceCount: number }>;
}

const GENERIC_PRIOR: Record<string, number> = {
  "first.last": 0.5,
  first: 0.45,
  flast: 0.4,
  firstlast: 0.35,
  first_last: 0.3,
  firstl: 0.28,
  "f.last": 0.26,
  "last.first": 0.22,
  lastf: 0.2,
};

export function inferEmails(fullName: string, company: CompanyPatternKnowledge): EmailCandidate[] {
  if (!company.domain) return []; // never invent a domain
  const name = parseName(fullName);
  const seen = new Set<string>();
  const out: EmailCandidate[] = [];

  // Learned company patterns first (PRD §70 waterfall step 3)
  const learned = [...company.learnedPatterns].sort((a, b) => b.confidence - a.confidence);
  for (const lp of learned) {
    const email = applyPattern(lp.pattern, name, company.domain);
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push({
        email,
        pattern: lp.pattern,
        // Company evidence raises confidence, capped below "verified" territory.
        confidence: Math.min(0.85, 0.55 + 0.1 * Math.min(3, lp.evidenceCount)),
        basis: "company_pattern",
      });
    }
  }

  // Generic library (waterfall step 4) — low confidence by construction.
  for (const p of PATTERNS) {
    const email = applyPattern(p, name, company.domain);
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push({ email, pattern: p, confidence: GENERIC_PRIOR[p] ?? 0.2, basis: "generated" });
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}
