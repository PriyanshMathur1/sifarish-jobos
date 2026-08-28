"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getDb, trackerRepo } from "@jobos/db";
import { APPLICATION_STATUSES } from "@jobos/db/repo/tracker";

export async function markAppliedAction(jobId: string): Promise<void> {
  const { userId } = await requireUser();
  await trackerRepo.markApplied(getDb(), userId, z.string().uuid().parse(jobId));
  revalidatePath("/tracker");
  revalidatePath(`/jobs/${jobId}`);
}

export async function changeStatusAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const applicationId = z.string().uuid().parse(formData.get("applicationId"));
  const to = z.enum(APPLICATION_STATUSES).parse(formData.get("status"));
  await trackerRepo.changeStatus(getDb(), userId, applicationId, to);
  revalidatePath("/tracker");
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const applicationId = z.string().uuid().parse(formData.get("applicationId"));
  const body = z.string().trim().min(1).max(4000).parse(formData.get("body"));
  await trackerRepo.addNote(getDb(), userId, "application", applicationId, body);
  revalidatePath("/tracker");
}

export async function addReminderAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const applicationId = z.string().uuid().parse(formData.get("applicationId"));
  const message = z.string().trim().min(1).max(500).parse(formData.get("message"));
  const dueAt = z.coerce.date().parse(formData.get("dueAt"));
  await trackerRepo.addReminder(getDb(), userId, "application", applicationId, dueAt, message);
  revalidatePath("/tracker");
}

export async function completeReminderAction(reminderId: string): Promise<void> {
  const { userId } = await requireUser();
  await trackerRepo.completeReminder(getDb(), userId, z.string().uuid().parse(reminderId));
  revalidatePath("/tracker");
}
