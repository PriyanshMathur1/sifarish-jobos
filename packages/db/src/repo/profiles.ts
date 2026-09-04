import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.ts";
import { answerBank, candidatePreferences, profiles, resumes } from "../schema/index.ts";

export interface ProfileInput {
  fullName: string | null;
  currentTitle: string | null;
  yearsExperience: number | null;
  skills: string[];
  locations: string[];
}

/** Owner-scoped: a profile is only ever read/written for the given userId. */
export async function getProfile(db: Db, userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return row ?? null;
}

export async function upsertProfile(db: Db, userId: string, input: ProfileInput): Promise<void> {
  await db
    .insert(profiles)
    .values({ userId, ...input, summarySource: "manual" })
    .onConflictDoUpdate({ target: profiles.userId, set: { ...input } });
}

// ── Application details ─────────────────────────────────────────

export interface ApplicationDetailsInput {
  phone: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  currentLocation: string | null;
  noticePeriodDays: number | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
  workAuthorization: string | null;
  willingToRelocate: boolean | null;
}

export async function upsertApplicationDetails(
  db: Db,
  userId: string,
  input: ApplicationDetailsInput,
): Promise<void> {
  await db
    .insert(profiles)
    .values({ userId, ...input })
    .onConflictDoUpdate({ target: profiles.userId, set: { ...input } });
}

// ── Matching preferences ────────────────────────────────────────

export interface PreferencesInput {
  targetRoles: string[];
  targetFunctions: string[];
  locations: string[];
  remotePref: "remote" | "hybrid" | "office" | "any";
  excludedCompanies: string[];
  industriesExcluded: string[];
  strictness: Record<string, "required" | "preferred">;
}

export async function getPreferences(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(candidatePreferences)
    .where(eq(candidatePreferences.userId, userId));
  return row ?? null;
}

export async function upsertPreferences(
  db: Db,
  userId: string,
  input: PreferencesInput,
): Promise<void> {
  await db
    .insert(candidatePreferences)
    .values({ userId, ...input })
    .onConflictDoUpdate({ target: candidatePreferences.userId, set: { ...input } });
}

// ── Resumes ─────────────────────────────────────────────────────

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export interface ResumeMeta {
  id: string;
  label: string;
  fileName: string;
  mime: string;
  bytes: number;
  isDefault: boolean;
  createdAt: Date;
}

export async function listResumes(db: Db, userId: string): Promise<ResumeMeta[]> {
  return db
    .select({
      id: resumes.id,
      label: resumes.label,
      fileName: resumes.fileName,
      mime: resumes.mime,
      bytes: resumes.bytes,
      isDefault: resumes.isDefault,
      createdAt: resumes.createdAt,
    })
    .from(resumes)
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumes.isDefault), desc(resumes.createdAt));
}

export async function addResume(
  db: Db,
  userId: string,
  input: { label: string; fileName: string; mime: string; content: Buffer },
): Promise<string> {
  if (input.content.byteLength > RESUME_MAX_BYTES) throw new Error("resume too large");
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: resumes.id })
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .limit(1);
    const isDefault = existing.length === 0; // first upload becomes the default
    const [row] = await tx
      .insert(resumes)
      .values({
        userId,
        label: input.label,
        fileName: input.fileName,
        mime: input.mime,
        bytes: input.content.byteLength,
        content: input.content,
        isDefault,
      })
      .onConflictDoUpdate({
        target: [resumes.userId, resumes.label],
        set: {
          fileName: input.fileName,
          mime: input.mime,
          bytes: input.content.byteLength,
          content: input.content,
        },
      })
      .returning({ id: resumes.id });
    return row!.id;
  });
}

export async function setDefaultResume(db: Db, userId: string, resumeId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(resumes).set({ isDefault: false }).where(eq(resumes.userId, userId));
    await tx
      .update(resumes)
      .set({ isDefault: true })
      .where(and(eq(resumes.userId, userId), eq(resumes.id, resumeId)));
  });
}

export async function deleteResume(db: Db, userId: string, resumeId: string): Promise<void> {
  await db.delete(resumes).where(and(eq(resumes.userId, userId), eq(resumes.id, resumeId)));
}

/** Full row including bytes: only for the download route and the runner. */
export async function getResumeFile(db: Db, userId: string, resumeId: string) {
  const [row] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.id, resumeId)));
  return row ?? null;
}

export async function getDefaultResumeFile(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isDefault, true)));
  return row ?? null;
}

// ── Answer bank ─────────────────────────────────────────────────

/** Normalize a form question to a lookup key: lowercase, punctuation out, spaces to dashes. */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(please|kindly|your|the|a|an|of|in|to|for|do|you|are|is|what|which|how)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .slice(0, 80);
}

export async function listAnswers(db: Db, userId: string) {
  return db
    .select()
    .from(answerBank)
    .where(eq(answerBank.userId, userId))
    .orderBy(answerBank.questionText);
}

export async function upsertAnswer(
  db: Db,
  userId: string,
  questionText: string,
  answer: string,
): Promise<void> {
  const key = questionKey(questionText);
  if (!key) return;
  await db
    .insert(answerBank)
    .values({ userId, questionKey: key, questionText: questionText.trim(), answer })
    .onConflictDoUpdate({
      target: [answerBank.userId, answerBank.questionKey],
      set: { questionText: questionText.trim(), answer },
    });
}

export async function deleteAnswer(db: Db, userId: string, answerId: string): Promise<void> {
  await db.delete(answerBank).where(and(eq(answerBank.userId, userId), eq(answerBank.id, answerId)));
}
