import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb, applyRepo } from "@sifarish/db";
import { requireRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

/** The runner's pull: due attempts plus the identity to fill forms with. */
export async function GET(req: NextRequest) {
  const auth = await requireRunner(req);
  if (auth instanceof NextResponse) return auth;
  const limit = z.coerce.number().int().min(1).max(20).catch(5).parse(req.nextUrl.searchParams.get("limit") ?? 5);
  const bundle = await applyRepo.runnerBundle(getDb(), auth.userId, limit);
  return NextResponse.json({ runner: auth.name, ...bundle });
}
