import { SKILL_ALIASES, AMBIGUOUS_SKILLS } from "../taxonomy/seeds.ts";
import { normalizeSkill } from "../taxonomy/taxonomy.ts";

/**
 * Skill mentions in free text (a job description), resolved to canonical
 * skill names via the taxonomy. Lexicon = alias table + any extra terms the
 * caller supplies (typically the candidate's own skills, so a skill the
 * taxonomy has never heard of still matches when the JD names it verbatim).
 *
 * Pure. Word-boundary matching; ambiguous tokens (pm, ba, qa...) are skipped
 * because a bare "qa" in a JD is not evidence of anything (PRD §37).
 */

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function boundaryRegex(term: string): RegExp {
  // Terms like "node.js" or "a/b testing" contain non-word chars; \b would
  // misfire on their edges, so anchor on "not a letter/digit" instead.
  return new RegExp(`(^|[^a-z0-9])${escape(term)}(?=$|[^a-z0-9])`, "i");
}

export function extractSkills(text: string, extraTerms: readonly string[] = []): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = new Set<string>();

  for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
    if (AMBIGUOUS_SKILLS.has(alias)) continue;
    if (boundaryRegex(alias).test(lower)) found.add(canonical);
  }
  for (const term of extraTerms) {
    const key = term.trim();
    if (key.length < 2 || AMBIGUOUS_SKILLS.has(key.toLowerCase())) continue;
    if (boundaryRegex(key.toLowerCase()).test(lower)) found.add(normalizeSkill(key));
  }
  return [...found];
}
