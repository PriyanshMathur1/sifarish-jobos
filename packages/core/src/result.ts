/**
 * Result type — explicit success/failure without exceptions crossing seams.
 * Modules whose interface says `Result` never throw for expected failures.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error });

export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap() on error result: ${JSON.stringify(r.error)}`);
}
