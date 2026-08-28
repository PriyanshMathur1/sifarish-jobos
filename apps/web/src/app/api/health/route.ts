import { NextResponse } from "next/server";
import { getDb } from "@sifarish/db";
import { logger } from "@sifarish/core";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "up" });
  } catch (e) {
    logger.error({ err: e }, "health check failed");
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
