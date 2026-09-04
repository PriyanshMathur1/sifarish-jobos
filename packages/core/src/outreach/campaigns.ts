import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sifarish/db";
import { logger } from "../logger.ts";
import { type Result, ok, err } from "../result.ts";
import type { GmailClient } from "./gmail.ts";
import { approveOutreach, prepareOutreach, emailHash } from "./outreach.ts";

/**
 * Campaigns (AUTOPILOT-PLAN A4): one approval for a batch, then the worker
 * sends one message at a time inside the rails:
 *
 * - user daily cap = min(campaign.dailyCap, CAMPAIGN_DAILY_CAP_MAX), and a
 *   warm-up cap for the first week of a freshly connected mailbox
 * - per-company cap: at most N messages to one company per 14 days
 * - spacing: at most floor(tickSeconds / spacingSec) sends per tick
 * - 14-day recipient dedup and suppression, via approveOutreach
 * - bounce circuit breaker: over 5% bounces on 10+ sends today pauses every
 *   running campaign for that user
 * - follow-ups reply in-thread and stop on reply, bounce, or manual stop
 *
 * Every send is still an outreach_messages row, still audit-logged.
 */

export interface CampaignDeps {
  db: Db;
  gmail: GmailClient;
  directSendEnabled: boolean;
  /** hard ceiling regardless of what a campaign asks for */
  dailyCapMax: number;
  perCompanyPer14d: number;
  warmupDays: number;
  warmupDailyCap: number;
  tickSeconds: number;
  messageIdHost: string;
  /** address campaigns send from; used to tell our thread messages from replies */
  userEmail: string | null;
}

export interface CreateCampaignInput {
  name: string;
  jobId: string | null;
  contactIds: string[];
  steps: Array<{ day: number; templateId: string }>;
  dailyCap: number;
  spacingSec: number;
}

export type CreateError =
  | { kind: "no_steps" }
  | { kind: "no_recipients" }
  | { kind: "not_found"; what: string };

export const UNSUBSCRIBE_LINE =
  "If you'd rather not hear from me again, just reply with \"unsubscribe\" and I won't write again.";

const DEDUP_DAYS = 14;

/** Create in DRAFT with a per-recipient pre-check, so the review screen can show who would be skipped and why. */
export async function createCampaign(
  db: Db,
  userId: string,
  input: CreateCampaignInput,
): Promise<Result<{ campaignId: string; queued: number; skipped: number }, CreateError>> {
  if (input.steps.length === 0) return err({ kind: "no_steps" });
  const contactIds = [...new Set(input.contactIds)];
  if (contactIds.length === 0) return err({ kind: "no_recipients" });

  const [campaign] = await db
    .insert(schema.campaigns)
    .values({
      userId,
      name: input.name,
      jobId: input.jobId,
      steps: input.steps.map((s, i) => ({ day: i === 0 ? 0 : Math.max(1, s.day), templateId: s.templateId })),
      dailyCap: input.dailyCap,
      spacingSec: input.spacingSec,
    })
    .returning({ id: schema.campaigns.id });
  const campaignId = campaign!.id;

  let queued = 0;
  let skipped = 0;
  for (const contactId of contactIds) {
    const check = await prepareOutreach(db, userId, {
      contactId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      templateId: input.steps[0]!.templateId,
    });
    let skipReason: string | null = null;
    if (!check.ok) {
      skipReason =
        check.error.kind === "missing_vars"
          ? `missing ${check.error.missing.join(", ")}`
          : check.error.kind === "not_found"
            ? `${check.error.what} not found`
            : check.error.kind;
    } else {
      const [recent] = await db
        .select({ id: schema.outreachMessages.id })
        .from(schema.outreachMessages)
        .where(
          and(
            eq(schema.outreachMessages.userId, userId),
            eq(schema.outreachMessages.toEmail, check.value.toEmail),
            gte(schema.outreachMessages.createdAt, sql`now() - interval '${sql.raw(String(DEDUP_DAYS))} days'`),
            sql`${schema.outreachMessages.status} in ('PREPARED','DRAFTED','SENT','REPLIED')`,
          ),
        );
      if (recent) skipReason = `contacted in the last ${DEDUP_DAYS} days`;
    }
    await db.insert(schema.campaignRecipients).values({
      campaignId,
      userId,
      contactId,
      state: skipReason ? "SKIPPED" : "QUEUED",
      skipReason,
    });
    if (skipReason) skipped += 1;
    else queued += 1;
  }
  return ok({ campaignId, queued, skipped });
}

export async function setCampaignStatus(
  db: Db,
  userId: string,
  campaignId: string,
  status: "RUNNING" | "PAUSED" | "CANCELLED",
  reason: string | null = null,
): Promise<boolean> {
  const set =
    status === "RUNNING"
      ? { status, approvedAt: new Date(), pauseReason: null }
      : status === "PAUSED"
        ? { status, pauseReason: reason }
        : { status, completedAt: new Date() };
  const rows = await db
    .update(schema.campaigns)
    .set(set)
    .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.userId, userId)))
    .returning({ id: schema.campaigns.id });
  if (rows.length === 0) return false;
  if (status === "CANCELLED") {
    await db
      .update(schema.campaignRecipients)
      .set({ state: "STOPPED" })
      .where(
        and(
          eq(schema.campaignRecipients.campaignId, campaignId),
          inArray(schema.campaignRecipients.state, ["QUEUED", "WAITING"]),
        ),
      );
  }
  return true;
}

async function sentTodayCount(db: Db, userId: string): Promise<{ sent: number; bounced: number }> {
  const [row] = (await db
    .select({
      sent: sql<number>`count(*) filter (where status in ('PREPARED','SENT','REPLIED','BOUNCED'))::int`,
      bounced: sql<number>`count(*) filter (where status = 'BOUNCED')::int`,
    })
    .from(schema.outreachMessages)
    .where(
      and(
        eq(schema.outreachMessages.userId, userId),
        eq(schema.outreachMessages.mode, "send"),
        gte(schema.outreachMessages.createdAt, sql`date_trunc('day', now())`),
      ),
    )) as [{ sent: number; bounced: number }];
  return row;
}

async function firstSendAt(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`min(sent_at)` })
    .from(schema.outreachMessages)
    .where(and(eq(schema.outreachMessages.userId, userId), eq(schema.outreachMessages.mode, "send")));
  return row?.at ? new Date(row.at) : null;
}

async function companySends14d(db: Db, userId: string, companyId: string): Promise<number> {
  const [row] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.outreachMessages)
    .innerJoin(schema.contacts, eq(schema.outreachMessages.contactId, schema.contacts.id))
    .where(
      and(
        eq(schema.outreachMessages.userId, userId),
        eq(schema.contacts.companyId, companyId),
        eq(schema.outreachMessages.step, 0),
        gte(schema.outreachMessages.createdAt, sql`now() - interval '14 days'`),
        sql`${schema.outreachMessages.status} in ('PREPARED','SENT','REPLIED')`,
      ),
    )) as [{ n: number }];
  return row.n;
}

export interface DrainOutcome {
  sent: number;
  skipped: number;
  failed: number;
  capReached: boolean;
  pausedForBounces: boolean;
}

/** One tick: send what is due for this user, inside every rail. Idempotent per recipient state. */
export async function drainCampaigns(deps: CampaignDeps, userId: string, now = new Date()): Promise<DrainOutcome> {
  const { db } = deps;
  const out: DrainOutcome = { sent: 0, skipped: 0, failed: 0, capReached: false, pausedForBounces: false };
  if (!deps.directSendEnabled) return out;

  const running = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.userId, userId), eq(schema.campaigns.status, "RUNNING")));
  if (running.length === 0) return out;

  // Bounce circuit breaker (checked before anything goes out).
  const today = await sentTodayCount(db, userId);
  if (today.sent >= 10 && today.bounced / today.sent > 0.05) {
    for (const c of running) await setCampaignStatus(db, userId, c.id, "PAUSED", "bounce rate over 5% today");
    logger.warn({ userId, ...today }, "campaigns paused: bounce rate");
    out.pausedForBounces = true;
    return out;
  }

  // Effective daily cap: campaign ask, hard max, warm-up.
  const first = await firstSendAt(db, userId);
  const inWarmup = !first || now.getTime() - first.getTime() < deps.warmupDays * 86_400_000;
  const askCap = Math.min(...running.map((c) => c.dailyCap));
  let cap = Math.min(askCap, deps.dailyCapMax);
  if (inWarmup) cap = Math.min(cap, deps.warmupDailyCap);
  let budget = cap - today.sent;
  if (budget <= 0) {
    out.capReached = true;
    return out;
  }

  // Spacing: at most this many per tick, so the day's budget is spread out.
  const spacing = Math.max(30, Math.min(...running.map((c) => c.spacingSec)));
  budget = Math.min(budget, Math.max(1, Math.floor(deps.tickSeconds / spacing)));

  const due = await db
    .select({
      recipient: schema.campaignRecipients,
      campaign: schema.campaigns,
      contact: schema.contacts,
    })
    .from(schema.campaignRecipients)
    .innerJoin(schema.campaigns, eq(schema.campaignRecipients.campaignId, schema.campaigns.id))
    .innerJoin(schema.contacts, eq(schema.campaignRecipients.contactId, schema.contacts.id))
    .where(
      and(
        eq(schema.campaignRecipients.userId, userId),
        eq(schema.campaigns.status, "RUNNING"),
        inArray(schema.campaignRecipients.state, ["QUEUED", "WAITING"]),
        or(isNull(schema.campaignRecipients.nextAt), lte(schema.campaignRecipients.nextAt, now)),
      ),
    )
    .orderBy(schema.campaignRecipients.step, schema.campaignRecipients.createdAt)
    .limit(budget * 3);

  for (const { recipient, campaign, contact } of due) {
    if (budget <= 0) {
      out.capReached = true;
      break;
    }
    const step = campaign.steps[recipient.step];
    if (!step) {
      await db.update(schema.campaignRecipients).set({ state: "DONE" }).where(eq(schema.campaignRecipients.id, recipient.id));
      continue;
    }

    // Per-company cap only applies to first touches.
    if (recipient.step === 0 && contact.companyId) {
      const n = await companySends14d(db, userId, contact.companyId);
      if (n >= deps.perCompanyPer14d) {
        await db
          .update(schema.campaignRecipients)
          .set({ state: "SKIPPED", skipReason: `company cap (${deps.perCompanyPer14d} per 14 days)` })
          .where(eq(schema.campaignRecipients.id, recipient.id));
        out.skipped += 1;
        continue;
      }
    }

    const prepared = await prepareOutreach(db, userId, {
      contactId: contact.id,
      ...(campaign.jobId ? { jobId: campaign.jobId } : {}),
      templateId: step.templateId,
    });
    if (!prepared.ok) {
      await db
        .update(schema.campaignRecipients)
        .set({ state: "SKIPPED", skipReason: prepared.error.kind })
        .where(eq(schema.campaignRecipients.id, recipient.id));
      out.skipped += 1;
      continue;
    }

    // Follow-ups reply in the root thread with a "Re:" subject.
    let thread: { threadId: string; inReplyTo: string } | undefined;
    let subject = prepared.value.subject;
    if (recipient.step > 0 && recipient.rootMessageId) {
      const [root] = await db
        .select({ threadId: schema.outreachMessages.gmailThreadId, rfc: schema.outreachMessages.rfcMessageId, subject: schema.outreachMessages.subject })
        .from(schema.outreachMessages)
        .where(eq(schema.outreachMessages.id, recipient.rootMessageId));
      if (root?.threadId && root.rfc) {
        thread = { threadId: root.threadId, inReplyTo: root.rfc };
        subject = root.subject.startsWith("Re:") ? root.subject : `Re: ${root.subject}`;
      }
    }
    const body = recipient.step === 0 ? `${prepared.value.body.trimEnd()}\n\n${UNSUBSCRIBE_LINE}` : prepared.value.body;

    const approved = await approveOutreach(
      { db, gmail: deps.gmail, directSendEnabled: true, dailySendCap: cap, messageIdHost: deps.messageIdHost },
      userId,
      {
        contactId: contact.id,
        jobId: campaign.jobId,
        templateId: step.templateId,
        subject,
        body,
        campaign: { campaignId: campaign.id, step: recipient.step, ...(thread ? { thread } : {}) },
      },
      "send",
    );

    if (!approved.ok) {
      const terminal = approved.error.kind === "suppressed" || approved.error.kind === "no_email" || approved.error.kind === "duplicate_recipient";
      if (approved.error.kind === "cap_reached") {
        out.capReached = true;
        break;
      }
      await db
        .update(schema.campaignRecipients)
        .set({ state: terminal ? "SKIPPED" : "FAILED", skipReason: approved.error.kind })
        .where(eq(schema.campaignRecipients.id, recipient.id));
      if (terminal) out.skipped += 1;
      else out.failed += 1;
      continue;
    }

    const nextStep = recipient.step + 1;
    const next = campaign.steps[nextStep];
    await db
      .update(schema.campaignRecipients)
      .set({
        step: nextStep,
        state: next ? "WAITING" : "DONE",
        nextAt: next ? new Date(now.getTime() + next.day * 86_400_000) : null,
        rootMessageId: recipient.rootMessageId ?? approved.value.outreachId,
        lastMessageId: approved.value.outreachId,
      })
      .where(eq(schema.campaignRecipients.id, recipient.id));
    out.sent += 1;
    budget -= 1;
  }

  // Close campaigns with nothing left to do.
  for (const c of running) {
    const [open] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.campaignRecipients)
      .where(and(eq(schema.campaignRecipients.campaignId, c.id), inArray(schema.campaignRecipients.state, ["QUEUED", "WAITING"])));
    if (open && open.n === 0) {
      await db.update(schema.campaigns).set({ status: "DONE", completedAt: now }).where(eq(schema.campaigns.id, c.id));
    }
  }
  return out;
}

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery subsystem/i;
const BOUNCE_SUBJECT = /delivery status notification|undeliverable|delivery failure|returned mail/i;

export interface SyncOutcome {
  checked: number;
  replied: number;
  bounced: number;
}

/**
 * Reply and bounce detection over the threads we started (metadata only).
 * Reply → message REPLIED, recipient REPLIED (sequence stops), note on the
 * application. Bounce → message BOUNCED, contact INVALID, negative pattern
 * evidence, recipient BOUNCED.
 */
export async function syncReplies(deps: CampaignDeps, userId: string, now = new Date()): Promise<SyncOutcome> {
  const { db } = deps;
  const out: SyncOutcome = { checked: 0, replied: 0, bounced: 0 };
  const open = await db
    .select()
    .from(schema.outreachMessages)
    .where(
      and(
        eq(schema.outreachMessages.userId, userId),
        eq(schema.outreachMessages.mode, "send"),
        eq(schema.outreachMessages.status, "SENT"),
        sql`${schema.outreachMessages.gmailThreadId} is not null`,
        gte(schema.outreachMessages.sentAt, sql`now() - interval '30 days'`),
      ),
    )
    .limit(100);

  // One check per thread: intro + follow-ups share a thread and a verdict.
  const byThread = new Map<string, typeof open>();
  for (const m of open) {
    const list = byThread.get(m.gmailThreadId!) ?? [];
    list.push(m);
    byThread.set(m.gmailThreadId!, list);
  }

  for (const [threadId, msgs] of byThread) {
    const msg = msgs[0]!;
    const siblingIds = msgs.map((m) => m.id);
    const thread = await deps.gmail.getThread(threadId);
    if (!thread.ok) continue;
    out.checked += 1;
    const foreign = thread.value.messages.filter(
      (m) => !m.sent && !(deps.userEmail && m.from.toLowerCase().includes(deps.userEmail.toLowerCase())),
    );
    if (foreign.length === 0) continue;

    const bounce = foreign.find((m) => BOUNCE_FROM.test(m.from) || BOUNCE_SUBJECT.test(m.subject));
    if (bounce) {
      await db.update(schema.outreachMessages).set({ status: "BOUNCED" }).where(inArray(schema.outreachMessages.id, siblingIds));
      await db.update(schema.contacts).set({ emailStatus: "INVALID" }).where(eq(schema.contacts.id, msg.contactId));
      const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, msg.contactId));
      if (contact?.companyId) {
        const domain = msg.toEmail.split("@")[1] ?? "";
        await db
          .update(schema.companyEmailPatterns)
          .set({ evidenceCount: sql`greatest(0, ${schema.companyEmailPatterns.evidenceCount} - 1)`, confidence: sql`greatest(0.05, ${schema.companyEmailPatterns.confidence} - 0.15)` })
          .where(and(eq(schema.companyEmailPatterns.companyId, contact.companyId), eq(schema.companyEmailPatterns.domain, domain)));
      }
      await stopRecipient(db, msg.campaignId, msg.contactId, "BOUNCED");
      await db.insert(schema.auditLogs).values({ actorId: userId, action: "outreach.bounce", subjectType: "outreach_message", subjectId: msg.id, meta: { toEmailHash: emailHash(msg.toEmail) } });
      out.bounced += 1;
      continue;
    }

    const reply = foreign[0]!;
    await db
      .update(schema.outreachMessages)
      .set({ status: "REPLIED", repliedAt: reply.date ?? now })
      .where(inArray(schema.outreachMessages.id, siblingIds));
    await stopRecipient(db, msg.campaignId, msg.contactId, "REPLIED");
    if (msg.jobId) {
      const [app] = await db
        .select({ id: schema.applications.id })
        .from(schema.applications)
        .where(and(eq(schema.applications.userId, userId), eq(schema.applications.jobId, msg.jobId)));
      if (app) {
        await db.insert(schema.notes).values({
          userId,
          subjectType: "application",
          subjectId: app.id,
          body: `Reply received from ${reply.from} (${(reply.date ?? now).toISOString().slice(0, 10)})`,
        });
        await db.insert(schema.reminders).values({
          userId,
          subjectType: "application",
          subjectId: app.id,
          dueAt: new Date(now.getTime() + 2 * 86_400_000),
          message: `Answer the reply from ${reply.from}`,
        });
      }
    }
    out.replied += 1;
  }
  return out;
}

async function stopRecipient(db: Db, campaignId: string | null, contactId: string, state: "REPLIED" | "BOUNCED") {
  if (!campaignId) return;
  await db
    .update(schema.campaignRecipients)
    .set({ state, nextAt: null })
    .where(and(eq(schema.campaignRecipients.campaignId, campaignId), eq(schema.campaignRecipients.contactId, contactId)));
}
