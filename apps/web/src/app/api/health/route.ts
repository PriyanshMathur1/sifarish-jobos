import { NextResponse } from "next/server";
import { getDb } from "@jobos/db";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "up" });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
