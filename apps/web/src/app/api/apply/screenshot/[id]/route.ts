import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getDb, applyRepo } from "@sifarish/db";

/** Confirmation-page screenshot the runner stored for an attempt (owner-scoped). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "not found" }, { status: 404 });
  const png = await applyRepo.screenshotFor(getDb(), session.user.id, id);
  if (!png) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
}
