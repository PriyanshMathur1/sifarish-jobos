import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@sifarish/db";
import { schema } from "@sifarish/db";
import { type Result, ok, err } from "../result.ts";
import { renderTemplate, resolveRelevantSkill } from "./template-renderer.ts";
import type { GmailClient } from "./gmail.ts";
import { logger } from "../logger.ts";

/**
 * Outreach service (SPEC §2): prepare → (user edits) → approve, one message
 * at a time. There is deliberately NO bulk primitive here (PRD §157) — the
 * interface cannot express a mass send.
 *
 * approve() persists the message BEFORE talking to Gmail: a Gmail failure
 * marks the row FAILED with the error, and the text is never lost (PRD §123).
 */

export interface PrepareInput {
  contactId: string;
  jobId?: string;
  templateId: string;
  /** User-supplied values for variables the resolver couldn't fill. */
  overrides?: Record<string, string>;
}

export interface Preview {
  contactId: string;
  jobId: string | null;
  templateId: string;
  toEmail: string;
  subject: string;
  body: string;
}

export type PrepareError =
  | { kind: "not_found"; what: string }
  | { kind: "suppressed" }
  | { kind: "no_email" }
  | { kind: "missing_vars"; missing: string[] };

export const emailHash = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

export async function prepareOutreach(
  db: Db,
  userId: string,
  input: PrepareInput,
): Promise<Result<Preview, PrepareError>> {
  const [contact] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, input.contactId), eq(schema.contacts.userId, userId)));
  if (!contact) return err({ kind: "not_found", what: "contact" });
  if (contact.suppressedAt) return err({ kind: "suppressed" });
  if (!contact.businessEmail) return err({ kind: "no_email" });

  const [template] = await db
    .select()
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, input.templateId),
        sql`(${schema.templates.userId} = ${userId} or ${schema.templates.isBuiltin} = true)`,
      ),
    );
  if (!template) return err({ kind: "not_found", what: "template" });

  let job: typeof schema.jobs.$inferSelect | null = null;
  let jobCompanyName: string | null = null;
  if (input.jobId) {
    const [row] = await db
      .select({ job: schema.jobs, companyName: schema.companies.name })
      .from(schema.jobs)
      .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
      .where(eq(schema.jobs.id, input.jobId));
    if (!row) return err({ kind: "not_found", what: "job" });
    job = row.job;
    jobCompanyName = row.companyName;
  }

  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId));

  let contactCompanyName: string | null = null;
  if (contact.companyId) {
    const [c] = await db
      .select({ name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.id, contact.companyId));
    contactCompanyName = c?.name ?? null;
  }

  const relevantSkill =
    profile && job
      ? resolveRelevantSkill(profile.skills, `${job.title} ${job.descriptionText ?? ""}`)
      : null;

  const context: Record<string, string | undefined> = {
    first_name: contact.fullName.trim().split(/\s+/)[0],
    company: jobCompanyName ?? contactCompanyName ?? undefined,
    job_title: job?.title,
    candidate_name: profile?.fullName ?? undefined,
    current_title: profile?.currentTitle ?? undefined,
    relevant_skill: relevantSkill ?? undefined,
    ...input.overrides,
  };

  const rendered = renderTemplate({ subject: template.subject, body: template.body }, context);
  if (!rendered.ok) return err({ kind: "missing_vars", missing: rendered.error.missing });

  return ok({
    contactId: contact.id,
    jobId: job?.id ?? null,
    templateId: template.id,
    toEmail: contact.businessEmail,
    subject: rendered.value.subject,
    body: rendered.value.body,
  });
}

export interface ApproveDeps {
  db: Db;
  gmail: GmailClient;
  directSendEnabled: boolean;
  dailySendCap: number;
  /** host part of generated Message-IDs (APP_URL host) */
  messageIdHost?: string;
}

export type ApproveError =
  | { kind: "not_found"; what: string }
  | { kind: "suppressed" }
  | { kind: "no_email" }
  | { kind: "duplicate_recipient"; daysAgo: number }
  | { kind: "send_disabled" }
  | { kind: "cap_reached"; cap: number }
  | { kind: "gmail_failed"; detail: string };

export interface ApproveResult {
  outreachId: string;
  status: "DRAFTED" | "SENT" | "FAILED";
}

const DEDUP_DAYS = 14;

/**
 * The trust boundary: ids + the user's edited subject/body come from the
 * client, but the RECIPIENT is always re-derived server-side from the
 * owner-scoped contact row — a form cannot address anyone the user's
 * contact list doesn't hold, and per-contact suppression is re-checked here.
 */
export interface ApproveInput {
  contactId: string;
  jobId: string | null;
  templateId: string;
  subject: string;
  body: string;
  /** Campaign context: step > 0 is a follow-up in an existing thread, so recipient dedup is skipped. */
  campaign?: {
    campaignId: string;
    step: number;
    thread?: { threadId: string; inReplyTo: string };
  };
}

/** RFC 5322 Message-ID we stamp on every send, so follow-ups can reference it. */
export function newRfcMessageId(host: string): string {
  return `<${crypto.randomUUID()}@${host}>`;
}

export async function approveOutreach(
  deps: ApproveDeps,
  userId: string,
  input: ApproveInput,
  mode: "draft" | "send",
): Promise<Result<ApproveResult, ApproveError>> {
  const { db } = deps;

  // Owner-scoped contact lookup — the ONLY source of the recipient address.
  const [contact] = await db
    .select()
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, input.contactId), eq(schema.contacts.userId, userId)));
  if (!contact) return err({ kind: "not_found", what: "contact" });
  if (contact.suppressedAt) return err({ kind: "suppressed" });
  if (!contact.businessEmail) return err({ kind: "no_email" });
  const toEmail = contact.businessEmail;

  // Template must be builtin or the user's own.
  const [template] = await db
    .select({ id: schema.templates.id })
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, input.templateId),
        sql`(${schema.templates.userId} = ${userId} or ${schema.templates.isBuiltin} = true)`,
      ),
    );
  if (!template) return err({ kind: "not_found", what: "template" });

  const preview: Preview = {
    contactId: contact.id,
    jobId: input.jobId,
    templateId: template.id,
    toEmail,
    subject: input.subject,
    body: input.body,
  };

  if (mode === "send" && !deps.directSendEnabled) return err({ kind: "send_disabled" });
  const rfcMessageId = newRfcMessageId(deps.messageIdHost ?? "sifarish.local");

  // Guard checks + PREPARED insert run in ONE transaction under a per-user
  // advisory lock, so two concurrent approvals cannot both pass the
  // check-then-insert window for dedup or the daily cap. A PREPARED row
  // counts toward both from the instant it exists.
  type GuardFail = Extract<
    ApproveError,
    { kind: "suppressed" | "duplicate_recipient" | "cap_reached" }
  >;
  const guarded = await db.transaction(async (tx): Promise<Result<string, GuardFail>> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    // Suppression (PRD §75) — checked at send time too, not just discovery.
    const [suppressed] = await tx
      .select({ id: schema.contactSuppressions.id })
      .from(schema.contactSuppressions)
      .where(eq(schema.contactSuppressions.emailHash, emailHash(preview.toEmail)));
    if (suppressed) return err({ kind: "suppressed" });

    // Recipient dedup (PRD §80): one message per recipient per window —
    // PREPARED included, so an in-flight approval blocks a twin. Campaign
    // follow-ups reply inside their own thread and are exempt.
    const isFollowUp = (input.campaign?.step ?? 0) > 0;
    const [recent] = isFollowUp
      ? [undefined]
      : await tx
      .select({ createdAt: schema.outreachMessages.createdAt })
      .from(schema.outreachMessages)
      .where(
        and(
          eq(schema.outreachMessages.userId, userId),
          eq(schema.outreachMessages.toEmail, preview.toEmail),
          gte(
            schema.outreachMessages.createdAt,
            sql`now() - interval '${sql.raw(String(DEDUP_DAYS))} days'`,
          ),
          sql`${schema.outreachMessages.status} in ('PREPARED','DRAFTED','SENT','REPLIED')`,
        ),
      );
    if (recent) {
      const daysAgo = Math.floor((Date.now() - recent.createdAt.getTime()) / 86_400_000);
      return err({ kind: "duplicate_recipient", daysAgo });
    }

    if (mode === "send") {
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.outreachMessages)
        .where(
          and(
            eq(schema.outreachMessages.userId, userId),
            eq(schema.outreachMessages.mode, "send"),
            sql`${schema.outreachMessages.status} in ('PREPARED','SENT')`,
            gte(schema.outreachMessages.createdAt, sql`date_trunc('day', now())`),
          ),
        )) as [{ count: number }];
      if (count >= deps.dailySendCap) return err({ kind: "cap_reached", cap: deps.dailySendCap });
    }

    // Persist BEFORE Gmail — the message text must never be lost.
    const [row] = await tx
      .insert(schema.outreachMessages)
      .values({
        userId,
        contactId: preview.contactId,
        jobId: preview.jobId,
        templateId: preview.templateId,
        toEmail: preview.toEmail,
        subject: preview.subject,
        body: preview.body,
        mode,
        status: "PREPARED",
        campaignId: input.campaign?.campaignId ?? null,
        step: input.campaign?.step ?? 0,
        rfcMessageId: mode === "send" ? rfcMessageId : null,
      })
      .returning({ id: schema.outreachMessages.id });
    return ok(row!.id);
  });
  if (!guarded.ok) return guarded;
  const outreachId = guarded.value;

  const email = {
    to: preview.toEmail,
    subject: preview.subject,
    body: preview.body,
    ...(mode === "send" ? { messageId: rfcMessageId } : {}),
    ...(input.campaign?.thread ? { thread: input.campaign.thread } : {}),
  };
  const result =
    mode === "draft" ? await deps.gmail.createDraft(email) : await deps.gmail.send(email);

  if (!result.ok) {
    await db
      .update(schema.outreachMessages)
      .set({ status: "FAILED", error: JSON.stringify(result.error) })
      .where(eq(schema.outreachMessages.id, outreachId));
    logger.warn({ outreachId, error: result.error }, "gmail call failed — message preserved");
    return err({ kind: "gmail_failed", detail: result.error.kind });
  }

  const update =
    mode === "draft"
      ? { status: "DRAFTED" as const, gmailDraftId: (result.value as { draftId: string }).draftId }
      : {
          status: "SENT" as const,
          sentAt: new Date(),
          gmailThreadId: (result.value as { threadId: string }).threadId,
          gmailMessageId: (result.value as { messageId: string }).messageId,
        };
  await db
    .update(schema.outreachMessages)
    .set(update)
    .where(eq(schema.outreachMessages.id, outreachId));

  // Every draft/send is audit-logged (SPEC §5).
  await db.insert(schema.auditLogs).values({
    actorId: userId,
    action: mode === "draft" ? "outreach.draft" : "outreach.send",
    subjectType: "outreach_message",
    subjectId: outreachId,
    meta: { toEmailHash: emailHash(preview.toEmail) },
  });

  // Behaviour signal + CRM bump (PRD §51, §83).
  if (preview.jobId) {
    await db.insert(schema.userJobEvents).values({ userId, jobId: preview.jobId, type: "CONTACT" });
    await db
      .insert(schema.applications)
      .values({ userId, jobId: preview.jobId, status: "CONTACTED" })
      .onConflictDoNothing();
  }

  return ok({ outreachId, status: update.status });
}
