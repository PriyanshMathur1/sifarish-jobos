"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getDb } from "@sifarish/db";
import { approveOutreach, prepareOutreach, loadConfig, logger } from "@sifarish/core";
import { getGmailClientForUser } from "@/lib/gmail";
import { rateLimit } from "@/lib/rate-limit";

const approveInput = z.object({
  contactId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  templateId: z.string().uuid(),
  // No CR/LF in a header line — belt to the Gmail client's braces.
  subject: z
    .string()
    .min(1)
    .max(500)
    .regex(/^[^\r\n]*$/),
  body: z.string().min(1).max(10000),
  mode: z.enum(["draft", "send"]),
});

export async function approveAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const input = approveInput.parse({
    contactId: formData.get("contactId"),
    jobId: formData.get("jobId") || null,
    templateId: formData.get("templateId"),
    subject: formData.get("subject"),
    body: formData.get("body"),
    mode: formData.get("mode"),
  });

  if (!rateLimit(`outreach:${userId}`, { ratePerMinute: 10 }).allowed) {
    redirect("/outreach?error=rate_limited");
  }

  const gmail = await getGmailClientForUser(userId);
  if (!gmail) redirect("/outreach?error=gmail_not_connected");

  const config = loadConfig();
  const result = await approveOutreach(
    {
      db: getDb(),
      gmail,
      directSendEnabled: config.OUTREACH_DIRECT_SEND,
      dailySendCap: config.OUTREACH_DAILY_SEND_CAP,
    },
    userId,
    {
      contactId: input.contactId,
      jobId: input.jobId,
      templateId: input.templateId,
      subject: input.subject,
      body: input.body,
    },
    input.mode,
  );

  if (!result.ok) redirect(`/outreach?error=${result.error.kind}`);
  redirect(`/outreach?done=${result.value.status.toLowerCase()}`);
}

const MAX_BULK = 25;

/**
 * Bulk drafting (contacts page "Reach out to selected"): still no bulk SEND
 * — each contact goes through the same prepareOutreach → approveOutreach
 * (mode: "draft") path as the single-contact flow, one Gmail draft per
 * person, content re-derived server-side rather than trusted from the form.
 * A recipient dedup'd, suppressed, or otherwise unable to prepare is simply
 * skipped and counted — never lets one bad row abort the rest of the batch.
 */
export async function bulkApproveAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  const templateId = z.string().uuid().parse(formData.get("templateId"));
  const jobIdRaw = formData.get("jobId");
  const jobId = typeof jobIdRaw === "string" && jobIdRaw ? jobIdRaw : undefined;
  const contactIds = formData
    .getAll("c")
    .map(String)
    .filter((id) => z.string().uuid().safeParse(id).success)
    .slice(0, MAX_BULK);

  if (contactIds.length === 0) redirect("/contacts");

  if (!rateLimit(`outreach-bulk:${userId}`, { ratePerMinute: 3 }).allowed) {
    redirect("/outreach?error=rate_limited");
  }

  const gmail = await getGmailClientForUser(userId);
  if (!gmail) redirect("/outreach?error=gmail_not_connected");

  const db = getDb();
  const config = loadConfig();
  let created = 0;
  let skipped = 0;

  for (const contactId of contactIds) {
    const prep = await prepareOutreach(db, userId, {
      contactId,
      ...(jobId ? { jobId } : {}),
      templateId,
    });
    if (!prep.ok) {
      skipped++;
      continue;
    }
    const result = await approveOutreach(
      {
        db,
        gmail,
        directSendEnabled: config.OUTREACH_DIRECT_SEND,
        dailySendCap: config.OUTREACH_DAILY_SEND_CAP,
      },
      userId,
      {
        contactId: prep.value.contactId,
        jobId: prep.value.jobId,
        templateId: prep.value.templateId,
        subject: prep.value.subject,
        body: prep.value.body,
      },
      "draft", // bulk never sends directly — draft-only, by design
    );
    if (result.ok) {
      created++;
    } else {
      skipped++;
      logger.info({ contactId, error: result.error }, "bulk outreach: recipient skipped");
    }
  }

  redirect(`/outreach?bulk_created=${created}&bulk_skipped=${skipped}`);
}
