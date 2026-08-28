import { normalizeLocation } from "../taxonomy/taxonomy.ts";

/**
 * MarketFilter (grill G2) — ingest-time market eligibility.
 *
 * IN_CONFIRMED       any location resolves to a market country (APAC counts
 *                    for IN), or an explicitly market-eligible remote tag.
 * REMOTE_UNVERIFIED  remote job whose region is unstated/unknown — kept,
 *                    ranked below confirmed, badged honestly (PRD §34 spirit:
 *                    we don't know eligibility, so we say so).
 * REJECT             every stated location resolves outside the market, or a
 *                    non-remote job with no market location.
 */
export type MarketEligibility = "IN_CONFIRMED" | "REMOTE_UNVERIFIED" | "REJECT";

/** Region pseudo-codes that make a remote job eligible per market country. */
const REGION_ELIGIBLE: Record<string, string[]> = {
  IN: ["APAC"],
};

export function classifyMarket(
  locations: string[],
  remoteType: "remote" | "hybrid" | "onsite" | null,
  marketCountries: string[],
): MarketEligibility {
  const norms = locations.map(normalizeLocation);
  const eligibleRegions = new Set(
    marketCountries.flatMap((c) => [c, ...(REGION_ELIGIBLE[c] ?? [])]),
  );

  const anyMarket = norms.some((n) => n.country && eligibleRegions.has(n.country));
  if (anyMarket) return "IN_CONFIRMED";

  const anyRemoteSignal = remoteType === "remote" || norms.some((n) => n.kind === "remote");
  const statedForeign = norms.filter((n) => n.country && !eligibleRegions.has(n.country));
  const statedUnknownOrRemote = norms.every((n) => n.kind === "remote" || n.kind === "unknown");

  if (anyRemoteSignal) {
    // Remote with a stated non-market region ("Remote (US only)") → out.
    if (statedForeign.length > 0) return "REJECT";
    // Remote, region unstated/unknown → kept but flagged.
    if (norms.length === 0 || statedUnknownOrRemote) return "REMOTE_UNVERIFIED";
  }

  // "Anywhere" style tags normalize to remote kind without remoteType.
  if (norms.length > 0 && norms.every((n) => n.kind === "remote" && !n.country)) {
    return "REMOTE_UNVERIFIED";
  }

  return "REJECT";
}
