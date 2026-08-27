import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { loadConfig, requestLogger, PgBossQueue, QUEUES, registerHandlers } from "@jobos/core";
// handlers come from core so the worker and this route share one registry

export const maxDuration = 300;

function secretsMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Serverless-cron entry (grill G8): Vercel cron POSTs here twice daily.
 * Enqueues one orchestration tick, then drains the refresh queues in a
 * time-boxed batch — the same handlers the long-lived worker runs.
 */
export async function POST(req: NextRequest) {
  const config = loadConfig();
  const log = requestLogger(req.headers.get("x-request-id") ?? crypto.randomUUID());

  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secretsMatch(token, config.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const queue = new PgBossQueue(config.DATABASE_URL);
  await queue.start();
  try {
    registerHandlers(queue, config, { mode: "drain" });
    await queue.enqueue(QUEUES.refreshOrchestrate, {}, { singletonKey: "cron-tick" });
    const orchestrated = await queue.drain(QUEUES.refreshOrchestrate, 1);
    const refreshed = await queue.drain(QUEUES.refreshCompany, 200);
    log.info({ orchestrated, refreshed }, "cron drain complete");
    return NextResponse.json({ ok: true, orchestrated, refreshed });
  } finally {
    await queue.stop();
  }
}
