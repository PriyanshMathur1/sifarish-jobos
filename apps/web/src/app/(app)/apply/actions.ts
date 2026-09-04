"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, applyRepo, profilesRepo, audit } from "@sifarish/db";
import { requireUser } from "@/lib/session";

const uuid = z.string().uuid();

export async function updateApplyRules(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const input = {
    autoQueueBand: z.enum(["strong", "good", "none"]).parse(formData.get("autoQueueBand") ?? "strong"),
    queueSaved: formData.get("queueSaved") === "on",
    dailyCap: z.coerce.number().int().min(1).max(50).parse(formData.get("dailyCap") || 10),
    mode: z.enum(["confirm", "handsoff"]).parse(formData.get("mode") ?? "confirm"),
    maxAgeDays: z.coerce.number().int().min(1).max(60).parse(formData.get("maxAgeDays") || 14),
  };
  const db = getDb();
  await applyRepo.upsertRules(db, userId, input);
  await applyRepo.enqueueFromRules(db, userId);
  revalidatePath("/apply");
}

export async function queueJobForApply(jobId: string): Promise<void> {
  const { userId } = await requireUser();
  const id = uuid.parse(jobId);
  const result = await applyRepo.enqueueJob(getDb(), userId, id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/apply");
  if (result === "unsupported") redirect(`/jobs/${id}?apply=unsupported`);
}

export async function requeueAttempt(attemptId: string): Promise<void> {
  const { userId } = await requireUser();
  await applyRepo.setAttemptStatus(getDb(), userId, uuid.parse(attemptId), "QUEUED");
  revalidatePath("/apply");
}

export async function skipAttempt(attemptId: string): Promise<void> {
  const { userId } = await requireUser();
  await applyRepo.setAttemptStatus(getDb(), userId, uuid.parse(attemptId), "SKIPPED");
  revalidatePath("/apply");
}

/** Answer the question(s) a blocked attempt asked, then put it back in the queue. */
export async function answerAndRequeue(attemptId: string, formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const id = uuid.parse(attemptId);
  const db = getDb();
  const questions = formData.getAll("question").map(String);
  const answers = formData.getAll("answer").map(String);
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i]!.trim();
    const a = (answers[i] ?? "").trim();
    if (q.length >= 3 && a.length >= 1) await profilesRepo.upsertAnswer(db, userId, q, a.slice(0, 4000));
  }
  await applyRepo.setAttemptStatus(db, userId, id, "QUEUED");
  revalidatePath("/apply");
  revalidatePath("/profile");
}

export async function createDeviceTokenAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const name = z.string().trim().min(1).max(60).parse(String(formData.get("name") || "My computer"));
  const db = getDb();
  const { id, token } = await applyRepo.createDeviceToken(db, userId, name);
  await audit(db, { actorId: userId, action: "device_token.create", subjectType: "device_token", subjectId: id });
  // Shown exactly once, via the URL fragment-free query (page renders it, never stored in plaintext).
  redirect(`/apply?token=${encodeURIComponent(token)}`);
}

export async function revokeDeviceTokenAction(id: string): Promise<void> {
  const { userId } = await requireUser();
  const db = getDb();
  await applyRepo.revokeDeviceToken(db, userId, uuid.parse(id));
  await audit(db, { actorId: userId, action: "device_token.revoke", subjectType: "device_token", subjectId: id });
  revalidatePath("/apply");
}
