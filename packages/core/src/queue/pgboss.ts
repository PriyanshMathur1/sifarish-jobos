import PgBoss from "pg-boss";
import type { EnqueueOptions, JobHandler, Queue } from "./queue.ts";
import { logger } from "../logger.ts";

/**
 * pg-boss adapter for the Queue seam. Free-first: the queue lives in the
 * same Postgres as the data (PRD §146). Splitting later = a different
 * connection string, nothing else.
 */
export class PgBossQueue implements Queue {
  private boss: PgBoss;
  private handlers = new Map<string, JobHandler<object>>();
  private queuePolicies = new Map<string, "standard" | "short">();

  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString, schema: "pgboss" });
    this.boss.on("error", (e) => logger.error({ err: e }, "pg-boss error"));
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, wait: true });
  }

  /**
   * pg-boss only enforces singletonKey dedup on queues with the "short"
   * policy (unique index on created state). Any queue that ever sees a
   * singletonKey is created/upgraded to "short" — the seam's dedup
   * invariant must hold regardless of adapter details.
   */
  private async ensureQueue(name: string, needsSingleton: boolean): Promise<void> {
    const wanted = needsSingleton ? "short" : "standard";
    const current = this.queuePolicies.get(name);
    if (current === "short" || current === wanted) return;
    await this.boss.createQueue(name, { name, policy: wanted });
    this.queuePolicies.set(name, wanted);
  }

  async enqueue<T extends object>(
    name: string,
    payload: T,
    opts?: EnqueueOptions,
  ): Promise<string | null> {
    await this.ensureQueue(name, Boolean(opts?.singletonKey));
    return this.boss.send(name, payload, {
      ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      retryLimit: opts?.retryLimit ?? 3,
      retryDelay: opts?.retryDelaySeconds ?? 30,
      retryBackoff: true,
      ...(opts?.startAfterSeconds !== undefined ? { startAfter: opts.startAfterSeconds } : {}),
    });
  }

  async schedule(name: string, cron: string, tz: string): Promise<void> {
    await this.boss.createQueue(name);
    await this.boss.schedule(name, cron, {}, { tz });
  }

  register<T extends object>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<object>);
  }

  async work<T extends object>(name: string, handler: JobHandler<T>): Promise<void> {
    this.register(name, handler);
    await this.boss.createQueue(name);
    await this.boss.work(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data as T, { jobId: job.id });
      }
    });
  }

  async drain(name: string, max: number): Promise<number> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`drain: no handler registered for queue "${name}"`);
    await this.boss.createQueue(name);
    let done = 0;
    while (done < max) {
      const jobs = await this.boss.fetch(name, { batchSize: Math.min(5, max - done) });
      if (!jobs || jobs.length === 0) break;
      for (const job of jobs) {
        try {
          await handler(job.data as object, { jobId: job.id });
          await this.boss.complete(name, job.id);
        } catch (e) {
          logger.error({ err: e, queue: name, jobId: job.id }, "drain handler failed");
          const reason =
            e instanceof Error ? { message: e.message, stack: e.stack } : { value: String(e) };
          await this.boss.fail(name, job.id, reason);
        }
        done++;
      }
    }
    return done;
  }
}
