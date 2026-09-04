import { NextResponse, type NextRequest } from "next/server";
import { getDb, applyRepo } from "@sifarish/db";
import { rateLimit } from "@/lib/rate-limit";

/** Bearer device-token auth for the apply runner. Owner scoping flows from the token's user. */
export async function requireRunner(req: NextRequest): Promise<{ userId: string; name: string } | NextResponse> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 401 });
  const found = await applyRepo.userForDeviceToken(getDb(), token);
  if (!found) return NextResponse.json({ error: "invalid token" }, { status: 401 });
  if (!rateLimit(`runner:${found.userId}`, { ratePerMinute: 120 }).allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  return found;
}
