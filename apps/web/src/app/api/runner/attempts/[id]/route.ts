import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb, applyRepo, audit } from "@sifarish/db";
import { requireRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

const report = z.object({
  status: z.enum(["SUBMITTED", "BLOCKED", "FAILED", "SKIPPED"]),
  blocker: z.enum(["captcha", "login_wall", "unknown_question", "unsupported", "no_resume", "error", "removed", "timeout"]).nullable().optional(),
  blockerQuestion: z.string().max(500).nullable().optional(),
  questions: z.array(z.string().max(500)).max(20).optional(),
  error: z.string().max(2000).nullable().optional(),
  formUrl: z.string().url().max(1000).nullable().optional(),
  /** base64 JPEG, at most ~600 KB */
  screenshot: z.string().max(800_000).nullable().optional(),
});

/** Claim an attempt (QUEUED → RUNNING). 409 if someone else took it. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRunner(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await applyRepo.markRunning(getDb(), auth.userId, id, auth.name);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not queued" }, { status: 409 });
}

/** Report the outcome. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRunner(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const parsed = report.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad report" }, { status: 400 });
  const r = parsed.data;

  const db = getDb();
  const ok = await applyRepo.reportAttempt(db, auth.userId, id, {
    status: r.status,
    blocker: r.blocker ?? null,
    blockerQuestion: r.blockerQuestion ?? null,
    questions: r.questions ?? [],
    error: r.error ?? null,
    formUrl: r.formUrl ?? null,
    screenshot: r.screenshot ? Buffer.from(r.screenshot, "base64") : null,
  });
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(db, {
    actorId: auth.userId,
    action: `apply.${r.status.toLowerCase()}`,
    subjectType: "apply_attempt",
    subjectId: id,
    meta: { runner: auth.name, blocker: r.blocker ?? null },
  });
  return NextResponse.json({ ok: true });
}
