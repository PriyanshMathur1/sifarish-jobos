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

  async enqueue<T extends object>(name: string, payload: T, opts?: EnqueueOptions): Promise<string | null> {
    await this.boss.createQueue(name);
    return this.boss.send(name, payload, {
      ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      retryLimit: opts?.retryLimit ?? 3,
      retryDelay: opts?.retryDelaySeconds ?? 30,
      retryBackoff: true,
      ...(opts?.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
    });
  }

  async schedule(name: string, cron: string, tz: string): Promise<void> {
    await this.boss.createQueue(name);
    await this.boss.schedule(name, cron, {}, { tz });
  }

  async work<T extends object>(name: string, handler: JobHandler<T>): Promise<void> {
    this.handlers.set(name, handler as JobHandler<object>);
    await this.boss.createQueue(name);
    await this.boss.work(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data as T, { jobId: job.id });
      }
    });
  }

  /**
   * Batch-drain for serverless cron mode: fetch + run handlers inline until
   * `max` jobs are done or the queue is empty. Requires the handler to have
   * been registered via `work` — in drain mode we register without polling.
   */
  registerForDrain<T extends object>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler<object>);
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
          await this.boss.fail(name, job.id, e as object);
        }
        done++;
      }
    }
    return done;
  }
}
