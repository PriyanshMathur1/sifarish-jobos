/**
 * Freshness display (PRD §34): source-stated "Posted" vs JobOS-observed
 * "Discovered". Never conflated, never fabricated.
 */
export function freshnessLabel(sourcePostedAt: Date | null, firstSeenAt: Date): string {
  const target = sourcePostedAt ?? firstSeenAt;
  const verb = sourcePostedAt ? "Posted" : "Discovered";
  const days = Math.floor((Date.now() - target.getTime()) / 86_400_000);
  if (days <= 0) return `${verb} today`;
  if (days === 1) return `${verb} yesterday`;
  if (days < 30) return `${verb} ${days} days ago`;
  const months = Math.floor(days / 30);
  return `${verb} ${months} month${months > 1 ? "s" : ""} ago`;
}
