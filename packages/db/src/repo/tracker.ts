import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  applications,
  applicationEvents,
  companies,
  jobs,
  notes,
  reminders,
  userJobEvents,
} from "../schema/index.ts";

/** Tracker repository — application CRM-lite (PRD §83–§88), owner-scoped. */

export const APPLICATION_STATUSES = [
  "INTERESTED",
  "SAVED",
  "APPLIED",
  "CONTACTED",
  "SCREENING",
  "INTERVIEW",
  "FINAL_ROUND",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Terminal states can only move to WITHDRAWN-from-OFFER style corrections. */
export function isValidTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false;
  // Any state may be corrected to REJECTED or WITHDRAWN; otherwise forward-ish moves only.
  if (to === "REJECTED" || to === "WITHDRAWN") return true;
  const order = APPLICATION_STATUSES;
  return order.indexOf(to) > order.indexOf(from) || from === "REJECTED" || from === "WITHDRAWN";
}

export async function listApplications(db: Db, userId: string) {
  return db
    .select({
      id: applications.id,
      status: applications.status,
      appliedAt: applications.appliedAt,
      updatedAt: applications.updatedAt,
      jobId: applications.jobId,
      jobTitle: jobs.title,
      jobStatus: jobs.status,
      companyName: companies.name,
      snapshot: applications.jobSnapshot,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.updatedAt));
}

/**
 * Mark applied: upsert the application and take the immutable listing
 * snapshot (PRD §85) so the candidate keeps the JD even if it vanishes.
 */
export async function markApplied(db: Db, userId: string, jobId: string): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new Error("job not found");
  const snapshot = {
    title: job.title,
    descriptionHtml: job.descriptionHtml,
    locations: job.locations,
    remoteType: job.remoteType,
    employmentType: job.employmentType,
    applyUrl: job.applyUrl,
    sourceUrl: job.sourceUrl,
    sourcePostedAt: job.sourcePostedAt?.toISOString() ?? null,
    snapshotAt: new Date().toISOString(),
  };
  const [existing] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)));
  if (existing) {
    await db
      .update(applications)
      .set({
        status: "APPLIED",
        appliedAt: existing.appliedAt ?? new Date(),
        jobSnapshot: existing.jobSnapshot ?? snapshot,
      })
      .where(eq(applications.id, existing.id));
    await db.insert(applicationEvents).values({
      applicationId: existing.id,
      fromStatus: existing.status,
      toStatus: "APPLIED",
    });
  } else {
    const [created] = await db
      .insert(applications)
      .values({ userId, jobId, status: "APPLIED", appliedAt: new Date(), jobSnapshot: snapshot })
      .returning({ id: applications.id });
    await db
      .insert(applicationEvents)
      .values({ applicationId: created!.id, fromStatus: null, toStatus: "APPLIED" });
  }
  await db.insert(userJobEvents).values({ userId, jobId, type: "APPLY" });
}

export async function changeStatus(
  db: Db,
  userId: string,
  applicationId: string,
  to: ApplicationStatus,
): Promise<{ ok: boolean; reason?: string }> {
  const [app] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  if (!app) return { ok: false, reason: "not found" };
  if (!isValidTransition(app.status as ApplicationStatus, to)) {
    return { ok: false, reason: `cannot move ${app.status} → ${to}` };
  }
  await db.update(applications).set({ status: to }).where(eq(applications.id, app.id));
  await db
    .insert(applicationEvents)
    .values({ applicationId: app.id, fromStatus: app.status, toStatus: to });
  return { ok: true };
}

export async function addNote(
  db: Db,
  userId: string,
  subjectType: "job" | "company" | "application" | "contact",
  subjectId: string,
  body: string,
) {
  await db.insert(notes).values({ userId, subjectType, subjectId, body });
}

export async function listNotes(
  db: Db,
  userId: string,
  subjectType: "job" | "company" | "application" | "contact",
  subjectId: string,
) {
  return db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.subjectType, subjectType),
        eq(notes.subjectId, subjectId),
      ),
    )
    .orderBy(desc(notes.createdAt));
}

export async function addReminder(
  db: Db,
  userId: string,
  subjectType: "job" | "company" | "application" | "contact",
  subjectId: string,
  dueAt: Date,
  message: string,
) {
  await db.insert(reminders).values({ userId, subjectType, subjectId, dueAt, message });
}

export async function dueReminders(db: Db, userId: string) {
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, userId), isNull(reminders.doneAt)))
    .orderBy(asc(reminders.dueAt));
}

export async function completeReminder(db: Db, userId: string, reminderId: string) {
  await db
    .update(reminders)
    .set({ doneAt: new Date() })
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)));
}
