import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@jobos/db/schema/index";
import { runMigrations } from "@jobos/db/migrate";
import type { Queue, EnqueueOptions, JobHandler } from "../queue/queue.ts";
import { orchestrateRefresh, completeFinishedRuns, findMissedSlot } from "./orchestrator.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://jobos:jobos@localhost:5432/jobos_test";

/** In-memory Queue test double — records enqueues, dedupes singleton keys. */
class FakeQueue implements Queue {
  enqueued: Array<{ name: string; payload: object; key?: string }> = [];
  private keys = new Set<string>();
  async start() {}
  async stop() {}
  async enqueue(name: string, payload: object, opts?: EnqueueOptions) {
    if (opts?.singletonKey) {
      if (this.keys.has(opts.singletonKey)) return null;
      this.keys.add(opts.singletonKey);
    }
    this.enqueued.push({
      name,
      payload,
      ...(opts?.singletonKey ? { key: opts.singletonKey } : {}),
    });
    return String(this.enqueued.length);
  }
  async schedule() {}
  register<T extends object>(_name: string, _handler: JobHandler<T>) {}
  async work() {}
  async drain() {
    return 0;
  }
}

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_URL, max: 1 });
  await admin.query("drop schema if exists public cascade; create schema public;");
  await admin.query("drop schema if exists drizzle cascade; drop schema if exists pgboss cascade;");
  await admin.end();
  await runMigrations(TEST_URL);
  db = drizzle(new pg.Pool({ connectionString: TEST_URL, max: 4 }), { schema });

  await db.insert(schema.companies).values([
    { name: "Healthy", normalizedName: "healthy", atsProvider: "greenhouse", atsIdentifier: "h1" },
    {
      name: "Broken",
      normalizedName: "broken",
      atsProvider: "lever",
      atsIdentifier: "b1",
      consecutiveFailures: 7,
      lastCheckedAt: new Date(), // failed recently → inside cooldown
    },
    {
      name: "Paused",
      normalizedName: "paused",
      atsProvider: "ashby",
      atsIdentifier: "p1",
      status: "PAUSED",
    },
  ]);
});

describe("orchestrateRefresh", () => {
  it("fans out only eligible companies — paused and circuit-broken sources skipped (PRD §97)", async () => {
    const q = new FakeQueue();
    const { companies } = await orchestrateRefresh(db as never, q, "cron");
    expect(companies).toBe(1);
    expect(q.enqueued).toHaveLength(1);
    const payload = q.enqueued[0]!.payload as { companyId: string };
    const [c] = await db
      .select({ name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.id, payload.companyId));
    expect(c!.name).toBe("Healthy");
  });

  it("completeFinishedRuns closes only fully-processed runs", async () => {
    const [pending] = await db
      .insert(schema.refreshRuns)
      .values({
        scheduledAt: new Date(),
        status: "RUNNING",
        companiesTotal: 5,
        companiesProcessed: 3,
      })
      .returning();
    const [done] = await db
      .insert(schema.refreshRuns)
      .values({
        scheduledAt: new Date(),
        status: "RUNNING",
        companiesTotal: 2,
        companiesProcessed: 2,
      })
      .returning();

    await completeFinishedRuns(db as never);

    const [p] = await db.select().from(schema.refreshRuns).where(eq(schema.refreshRuns.id, pending!.id));
    const [d] = await db.select().from(schema.refreshRuns).where(eq(schema.refreshRuns.id, done!.id));
    expect(p!.status).toBe("RUNNING");
    expect(d!.status).toBe("COMPLETED");
  });
});

describe("findMissedSlot (PRD §144)", () => {
  const CRON = "0 3,15 * * *";
  const TZ = "Asia/Kolkata";
  // 2026-08-28T10:00 IST → previous slot is 03:00 IST = 2026-08-27T21:30:00Z
  const now = new Date("2026-08-28T04:30:00Z");

  it("reports the missed slot when no scheduled run covers it", async () => {
    await db.delete(schema.refreshRuns);
    const missed = await findMissedSlot(db as never, CRON, TZ, now);
    expect(missed).not.toBeNull();
    expect(missed!.toISOString()).toBe("2026-08-27T21:30:00.000Z");
  });

  it("a MANUAL run does NOT count as the schedule having fired", async () => {
    await db.insert(schema.refreshRuns).values({
      scheduledAt: new Date("2026-08-28T02:00:00Z"),
      status: "COMPLETED",
      trigger: "manual",
    });
    const missed = await findMissedSlot(db as never, CRON, TZ, now);
    expect(missed).not.toBeNull();
  });

  it("a cron or recovery run at/after the slot suppresses recovery", async () => {
    await db.insert(schema.refreshRuns).values({
      scheduledAt: new Date("2026-08-27T21:30:00Z"),
      status: "COMPLETED",
      trigger: "recovery",
    });
    const missed = await findMissedSlot(db as never, CRON, TZ, now);
    expect(missed).toBeNull();
  });
});
