/**
 * Queue seam (PRD §106). Callers know four verbs; the adapter hides
 * durability, retries, deduplication, and scheduling.
 *
 * Invariants every adapter must satisfy:
 * - `enqueue` with the same `singletonKey` while a job is pending is a no-op
 *   (dedup — a company is never refreshed twice concurrently in one run).
 * - Handlers may be retried; they MUST be idempotent (keyed on natural ids).
 * - `schedule` uses a 5-field cron expression evaluated in `tz`.
 */
export interface EnqueueOptions {
  singletonKey?: string;
  retryLimit?: number;
  retryDelaySeconds?: number;
  startAfterSeconds?: number;
}

export type JobHandler<T> = (payload: T, ctx: { jobId: string }) => Promise<void>;

export interface Queue {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue<T extends object>(
    name: string,
    payload: T,
    opts?: EnqueueOptions,
  ): Promise<string | null>;
  schedule(name: string, cron: string, tz: string): Promise<void>;
  /** Attach a handler without polling — used by drain mode. */
  register<T extends object>(name: string, handler: JobHandler<T>): void;
  /** Attach a handler AND start polling (long-lived worker mode). */
  work<T extends object>(name: string, handler: JobHandler<T>): Promise<void>;
  /** Drain up to `max` pending jobs of `name` synchronously (Vercel-cron batch mode). */
  drain(name: string, max: number): Promise<number>;
}

/** Queue names used across the app — one place, no string drift. */
export const QUEUES = {
  refreshOrchestrate: "job-refresh-orchestrate",
  refreshCompany: "job-refresh-company",
  atsDetection: "ats-detection",
  matchRecompute: "match-recompute",
  notifyTick: "notify-tick",
  cleanup: "cleanup",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
