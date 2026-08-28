import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PgBossQueue } from "./pgboss.ts";

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://sifarish:sifarish@localhost:5432/sifarish_test";

describe("PgBossQueue", () => {
  let queue: PgBossQueue;

  beforeAll(async () => {
    // Isolate runs: pg-boss state (incl. retrying jobs from prior runs) lives
    // in the pgboss schema of the test DB — start every suite from zero.
    const pool = new pg.Pool({ connectionString: TEST_URL, max: 1 });
    await pool.query("drop schema if exists pgboss cascade");
    await pool.end();
    queue = new PgBossQueue(TEST_URL);
    await queue.start();
  });

  afterAll(async () => {
    await queue.stop();
  });

  it("enqueue → register → drain roundtrip (serverless cron mode)", async () => {
    const seen: string[] = [];
    queue.register<{ v: string }>("test-drain", async (p) => {
      seen.push(p.v);
    });
    await queue.enqueue("test-drain", { v: "a" });
    await queue.enqueue("test-drain", { v: "b" });
    const drained = await queue.drain("test-drain", 10);
    expect(drained).toBe(2);
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("deduplicates on singletonKey while pending", async () => {
    queue.register("test-singleton", async () => {});
    const first = await queue.enqueue("test-singleton", { n: 1 }, { singletonKey: "k1" });
    const second = await queue.enqueue("test-singleton", { n: 2 }, { singletonKey: "k1" });
    expect(first).toBeTruthy();
    expect(second).toBeNull(); // pg-boss returns null for the deduped send
    const drained = await queue.drain("test-singleton", 10);
    expect(drained).toBe(1);
  });

  it("a failing handler does not throw out of drain and records the failure", async () => {
    queue.register("test-fail", async () => {
      throw new Error("boom");
    });
    await queue.enqueue("test-fail", { n: 1 }, { retryLimit: 0 });
    const drained = await queue.drain("test-fail", 10);
    expect(drained).toBe(1); // processed (and failed), not thrown
  });
});
