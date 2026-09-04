import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb, profilesRepo } from "@sifarish/db";
import { requireRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

/** Resume bytes for the runner (owner-scoped through the device token). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRunner(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const file = await profilesRepo.getResumeFile(getDb(), auth.userId, id);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.content), {
    headers: { "Content-Type": file.mime, "Content-Disposition": `attachment; filename="${file.fileName.replace(/"/g, "")}"`, "Cache-Control": "private, no-store" },
  });
}
