"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getDb } from "@jobos/db";
import { approveOutreach, loadConfig } from "@jobos/core";
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
