import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  loadConfig,
  requestLogger,
  PgBossQueue,
  QUEUES,
  registerHandlers,
  recoverMissedRun,
  tickRefresh,
} from "@sifarish/core";
import { completeFinishedRuns } from "@sifarish/core/ingestion/orchestrator";
import { getDb } from "@sifarish/db";

export const maxDuration = 300;

function secretsMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Serverless-cron entry (grill G8, Autopilot A1). Two callers, one handler set:
 *
 * - Vercel cron (no `tier`): full reconcile. recovery check → orchestrate →
 *   company fan-out → re-score → alerts → run completion.
 * - External ticker (`?tier=watch` every 15 min, `?tier=normal` hourly):
 *   refresh that tier only (no refresh_runs row), then alerts. This is what
 *   makes "new opening within 15 minutes" true on a Hobby plan whose own
 *   crons are daily.
 */
export async function POST(req: NextRequest) {
  const config = loadConfig();
  const log = requestLogger(req.headers.get("x-request-id") ?? crypto.randomUUID());

  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secretsMatch(token, config.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const tierParam = req.nextUrl.searchParams.get("tier");
  const tier = tierParam === "watch" || tierParam === "normal" ? tierParam : null;

  const queue = new PgBossQueue(config.DATABASE_URL);
  await queue.start();
  try {
    registerHandlers(queue, config, { mode: "drain" });
    const db = getDb();

    let orchestrated = 0;
    let recovered = false;
    let ticked = 0;
    if (tier) {
      ticked = (await tickRefresh(db, queue, tier)).companies;
    } else {
      recovered = await recoverMissedRun(queue, config);
      if (!recovered) {
        await queue.enqueue(QUEUES.refreshOrchestrate, {}, { singletonKey: "cron-tick" });
      }
      orchestrated = await queue.drain(QUEUES.refreshOrchestrate, 2);
    }

    const refreshed = await queue.drain(QUEUES.refreshCompany, 500);
    const rescored = tier ? 0 : await queue.drain(QUEUES.matchRecompute, 2);

    // Alerts every call: instant catch-up, digest when its hour has come.
    await queue.enqueue(
      QUEUES.autopilotTick,
      {},
      { singletonKey: `autopilot:${Math.floor(Date.now() / 300_000)}` },
    );
    const notified = await queue.drain(QUEUES.autopilotTick, 1);

    // Close out only runs whose fan-out fully processed (others keep RUNNING).
    if (!tier) await completeFinishedRuns(db);

    log.info({ tier, ticked, orchestrated, refreshed, rescored, notified, recovered }, "cron drain complete");
    return NextResponse.json({ ok: true, tier, ticked, orchestrated, refreshed, rescored, notified, recovered });
  } finally {
    await queue.stop();
  }
}
