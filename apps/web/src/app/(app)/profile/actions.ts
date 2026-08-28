"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import { getDb, profilesRepo, usersRepo, audit, schema } from "@jobos/db";
import { eq } from "drizzle-orm";

const csv = (s: FormDataEntryValue | null) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const profileInput = z.object({
  fullName: z.string().trim().max(200),
  currentTitle: z.string().trim().max(200),
  yearsExperience: z.union([z.coerce.number().int().min(0).max(60), z.literal("")]),
  skills: z.array(z.string().max(100)).max(50),
  locations: z.array(z.string().max(100)).max(20),
});

export async function updateProfile(formData: FormData): Promise<void> {
  const { userId } = await requireUser();

  const parsed = profileInput.parse({
    fullName: formData.get("fullName"),
    currentTitle: formData.get("currentTitle"),
    yearsExperience: formData.get("yearsExperience") || "",
    skills: csv(formData.get("skills")),
    locations: csv(formData.get("locations")),
  });

  await profilesRepo.upsertProfile(getDb(), userId, {
    fullName: parsed.fullName || null,
    currentTitle: parsed.currentTitle || null,
    yearsExperience: parsed.yearsExperience === "" ? null : parsed.yearsExperience,
    skills: parsed.skills,
    locations: parsed.locations,
  });

  revalidatePath("/profile");
}

/**
 * Account deletion (PRD §10, §109): audited, then the user row is removed and
 * every owned table cascades. The session cookie dies with its DB row.
 */
export async function deleteAccount(): Promise<void> {
  const { userId } = await requireUser();
  const db = getDb();
  await audit(db, {
    actorId: userId,
    action: "account.delete",
    subjectType: "user",
    subjectId: userId,
  });
  await usersRepo.deleteUserAccount(db, userId);
  await signOut({ redirect: false });
  redirect("/signin");
}

/** Disconnect Gmail (PRD §109): tokens are deleted, not merely flagged. */
export async function disconnectGmail(): Promise<void> {
  const { userId } = await requireUser();
  const db = getDb();
  await db.delete(schema.emailAccounts).where(eq(schema.emailAccounts.userId, userId));
  await audit(db, { actorId: userId, action: "gmail.disconnect", subjectType: "email_account" });
  revalidatePath("/profile");
}
