import { NextResponse, type NextRequest } from "next/server";
import { loadConfig, logger } from "@jobos/core";

export const maxDuration = 300;

/**
 * Serverless-cron entry (grill G8): Vercel cron POSTs here twice daily;
 * the handler enqueues the refresh orchestration and drains a time-boxed
 * batch. Phase 1 wires the real orchestrator; the auth contract is fixed now.
 */
export async function POST(req: NextRequest) {
  const config = loadConfig();
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (token !== config.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  logger.info("cron refresh invoked (orchestrator arrives in Phase 1)");
  return NextResponse.json({ ok: true, drained: 0 });
}
