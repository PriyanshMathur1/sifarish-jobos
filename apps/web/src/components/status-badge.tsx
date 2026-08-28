const STYLES: Record<string, string> = {
  VERIFIED: "border-good/40 text-good",
  HIGH_CONFIDENCE: "border-accent/40 text-accent",
  PROBABLE: "border-line text-muted",
  UNKNOWN: "border-line text-muted",
  INVALID: "border-warn/40 text-warn",
};

const LABELS: Record<string, string> = {
  VERIFIED: "Verified",
  HIGH_CONFIDENCE: "High confidence",
  PROBABLE: "Probable",
  UNKNOWN: "Unknown",
  INVALID: "Invalid",
};

/** Email-confidence badge — labels map 1:1 to PRD §73 statuses, no spin. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${STYLES[status] ?? "border-line text-muted"}`}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
