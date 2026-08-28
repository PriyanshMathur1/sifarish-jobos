import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import type { NormalizedJob } from "../providers/types.ts";
import { normalizeTitle, seniorityOf } from "../taxonomy/taxonomy.ts";

/**
 * Ingest-side enrichment of a provider's NormalizedJob: sanitized HTML,
 * plain text, taxonomy fields, and the content hash used for change
 * detection. Pure — unit-testable without a database.
 */

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "a",
    "div",
    "span",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "blockquote",
    "code",
    "pre",
  ],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https", "mailto"],
};

export interface EnrichedJob {
  normalized: NormalizedJob;
  descriptionHtml: string | null;
  descriptionText: string | null;
  normalizedTitle: string;
  titleFunction: string | null;
  seniority: string;
  contentHash: string;
}

export function enrichJob(n: NormalizedJob): EnrichedJob {
  const descriptionHtml = n.descriptionHtml ? sanitizeHtml(n.descriptionHtml, SANITIZE_OPTS) : null;
  const descriptionText = descriptionHtml
    ? sanitizeHtml(descriptionHtml, { allowedTags: [], allowedAttributes: {} })
        .replace(/\s+/g, " ")
        .trim()
    : null;
  const t = normalizeTitle(n.title);

  // Change detection hash over source-derived content only (PRD §27) —
  // Sifarish-observed timestamps must not churn versions.
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify({
        title: n.title,
        description: descriptionText,
        locations: n.locations,
        remoteType: n.remoteType,
        employmentType: n.employmentType,
        salary: n.salary,
        applyUrl: n.applyUrl,
      }),
    )
    .digest("hex");

  return {
    normalized: n,
    descriptionHtml,
    descriptionText,
    normalizedTitle: t.canonical,
    titleFunction: t.function,
    seniority: seniorityOf(n.title),
    contentHash,
  };
}
