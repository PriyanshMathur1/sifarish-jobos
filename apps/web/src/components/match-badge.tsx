import type { MatchBand } from "@sifarish/core";

const LABEL: Record<MatchBand, string> = {
  strong: "Strong match",
  good: "Good match",
  maybe: "Maybe",
  weak: "Weak",
};

/**
 * One accent, one radius: strong is filled, good is outlined, the rest are
 * muted text. The number is always shown so the band never has to be trusted
 * on its own.
 */
export function MatchBadge({ score, band }: { score: number; band: MatchBand }) {
  const cls =
    band === "strong"
      ? "bg-accent text-paper"
      : band === "good"
        ? "border border-accent text-accent"
        : "border border-line text-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <span className="tabular-nums">{score}</span>
      <span>{LABEL[band]}</span>
    </span>
  );
}
