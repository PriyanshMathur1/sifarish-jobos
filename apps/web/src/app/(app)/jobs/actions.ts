"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getDb, jobsRepo } from "@jobos/db";

const idSchema = z.string().uuid();

export async function saveJob(jobId: string): Promise<void> {
  const { userId } = await requireUser();
  await jobsRepo.recordJobEvent(getDb(), userId, idSchema.parse(jobId), "SAVE");
  revalidatePath("/jobs");
}

export async function unsaveJob(jobId: string): Promise<void> {
  const { userId } = await requireUser();
  await jobsRepo.recordJobEvent(getDb(), userId, idSchema.parse(jobId), "UNSAVE");
  revalidatePath("/jobs");
}

const hideReason = z
  .enum([
    "wrong_role",
    "wrong_seniority",
    "wrong_location",
    "wrong_industry",
    "wrong_company",
    "compensation",
    "not_interested",
    "already_applied",
    "other",
  ])
  .optional();

export async function hideJob(jobId: string, reason?: string): Promise<void> {
  const { userId } = await requireUser();
  await jobsRepo.recordJobEvent(
    getDb(),
    userId,
    idSchema.parse(jobId),
    "HIDE",
    hideReason.parse(reason || undefined),
  );
  revalidatePath("/jobs");
}
