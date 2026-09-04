"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import { getDb, profilesRepo, usersRepo, audit, schema } from "@sifarish/db";
import { RESUME_MAX_BYTES } from "@sifarish/db/repo/profiles";
import { recomputeForUser, logger } from "@sifarish/core";
import { eq } from "drizzle-orm";

const csv = (s: FormDataEntryValue | null) =>
  String(s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const optInt = (v: FormDataEntryValue | null, max: number) =>
  z.union([z.coerce.number().int().min(0).max(max), z.literal("")]).parse(v || "");

const optStr = (v: FormDataEntryValue | null, max = 200) =>
  z.string().trim().max(max).parse(String(v ?? "")) || null;

const optUrl = (v: FormDataEntryValue | null) => {
  const s = optStr(v, 500);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return z.string().url().parse(withScheme);
};

/** Re-score the whole graph for this user after anything the engine reads changed. */
async function rescore(userId: string): Promise<void> {
  try {
    await recomputeForUser(getDb(), userId);
  } catch (err) {
    logger.warn({ err, userId }, "match recompute after profile save failed");
  }
}

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

  await rescore(userId);
  revalidatePath("/profile");
  revalidatePath("/feed");
}

export async function updateApplicationDetails(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const relocate = String(formData.get("willingToRelocate") ?? "");
  const notice = optInt(formData.get("noticePeriodDays"), 365);
  const currentCtc = optInt(formData.get("currentCtcLpa"), 10_000);
  const expectedCtc = optInt(formData.get("expectedCtcLpa"), 10_000);

  await profilesRepo.upsertApplicationDetails(getDb(), userId, {
    phone: optStr(formData.get("phone"), 40),
    linkedinUrl: optUrl(formData.get("linkedinUrl")),
    portfolioUrl: optUrl(formData.get("portfolioUrl")),
    currentLocation: optStr(formData.get("currentLocation")),
    noticePeriodDays: notice === "" ? null : notice,
    currentCtcLpa: currentCtc === "" ? null : currentCtc,
    expectedCtcLpa: expectedCtc === "" ? null : expectedCtc,
    workAuthorization: optStr(formData.get("workAuthorization")),
    willingToRelocate: relocate === "" ? null : relocate === "yes",
  });
  revalidatePath("/profile");
}

const preferencesInput = z.object({
  targetRoles: z.array(z.string().max(100)).max(20),
  targetFunctions: z.array(z.string().max(100)).max(20),
  locations: z.array(z.string().max(100)).max(20),
  remotePref: z.enum(["remote", "hybrid", "office", "any"]),
  excludedCompanies: z.array(z.string().max(100)).max(100),
  industriesExcluded: z.array(z.string().max(100)).max(50),
  remoteRequired: z.boolean(),
  locationsRequired: z.boolean(),
});

export async function updatePreferences(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const p = preferencesInput.parse({
    targetRoles: csv(formData.get("targetRoles")),
    targetFunctions: csv(formData.get("targetFunctions")),
    locations: csv(formData.get("locations")),
    remotePref: formData.get("remotePref") ?? "any",
    excludedCompanies: csv(formData.get("excludedCompanies")),
    industriesExcluded: csv(formData.get("industriesExcluded")),
    remoteRequired: formData.get("remoteRequired") === "on",
    locationsRequired: formData.get("locationsRequired") === "on",
  });
  const strictness: Record<string, "required" | "preferred"> = {};
  if (p.remoteRequired) strictness.remote = "required";
  if (p.locationsRequired) strictness.locations = "required";

  await profilesRepo.upsertPreferences(getDb(), userId, {
    targetRoles: p.targetRoles,
    targetFunctions: p.targetFunctions,
    locations: p.locations,
    remotePref: p.remotePref,
    excludedCompanies: p.excludedCompanies,
    industriesExcluded: p.industriesExcluded,
    strictness,
  });

  await rescore(userId);
  revalidatePath("/profile");
  revalidatePath("/feed");
}

const ALLOWED_RESUME_MIME = new Set(["application/pdf"]);

export async function uploadResume(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const file = formData.get("file");
  const label = z.string().trim().min(1).max(60).parse(String(formData.get("label") ?? "Default"));
  if (!(file instanceof File) || file.size === 0) return;
  if (!ALLOWED_RESUME_MIME.has(file.type)) throw new Error("Only PDF resumes are accepted");
  if (file.size > RESUME_MAX_BYTES) throw new Error("Resume must be 5 MB or smaller");

  const content = Buffer.from(await file.arrayBuffer());
  await profilesRepo.addResume(getDb(), userId, {
    label,
    fileName: file.name.slice(0, 200),
    mime: file.type,
    content,
  });
  await audit(getDb(), { actorId: userId, action: "resume.upload", subjectType: "resume" });
  revalidatePath("/profile");
}

export async function setDefaultResume(resumeId: string): Promise<void> {
  const { userId } = await requireUser();
  await profilesRepo.setDefaultResume(getDb(), userId, z.string().uuid().parse(resumeId));
  revalidatePath("/profile");
}

export async function deleteResume(resumeId: string): Promise<void> {
  const { userId } = await requireUser();
  await profilesRepo.deleteResume(getDb(), userId, z.string().uuid().parse(resumeId));
  revalidatePath("/profile");
}

export async function saveAnswer(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const question = z.string().trim().min(3).max(300).parse(String(formData.get("question") ?? ""));
  const answer = z.string().trim().min(1).max(4000).parse(String(formData.get("answer") ?? ""));
  await profilesRepo.upsertAnswer(getDb(), userId, question, answer);
  revalidatePath("/profile");
}

export async function deleteAnswer(answerId: string): Promise<void> {
  const { userId } = await requireUser();
  await profilesRepo.deleteAnswer(getDb(), userId, z.string().uuid().parse(answerId));
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
