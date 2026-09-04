"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, audit } from "@sifarish/db";
import { createCampaign, setCampaignStatus, loadConfig } from "@sifarish/core";
import { requireUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

const uuid = z.string().uuid();

const createInput = z.object({
  name: z.string().trim().min(2).max(120),
  jobId: z.union([uuid, z.literal("")]),
  contactIds: z.array(uuid).min(1).max(200),
  template0: uuid,
  template1: z.union([uuid, z.literal("")]),
  day1: z.coerce.number().int().min(1).max(30),
  template2: z.union([uuid, z.literal("")]),
  day2: z.coerce.number().int().min(1).max(30),
  dailyCap: z.coerce.number().int().min(1).max(100),
  spacingSec: z.coerce.number().int().min(30).max(3600),
});

export async function createCampaignAction(formData: FormData): Promise<void> {
  const { userId } = await requireUser();
  if (!rateLimit(`campaign:create:${userId}`, { ratePerMinute: 5 }).allowed) redirect("/outreach/campaigns?error=rate_limited");
  const config = loadConfig();

  const p = createInput.parse({
    name: formData.get("name"),
    jobId: formData.get("jobId") ?? "",
    contactIds: formData.getAll("c").map(String),
    template0: formData.get("template0"),
    template1: formData.get("template1") ?? "",
    day1: formData.get("day1") || 4,
    template2: formData.get("template2") ?? "",
    day2: formData.get("day2") || 6,
    dailyCap: formData.get("dailyCap") || 40,
    spacingSec: formData.get("spacingSec") || 120,
  });

  const steps = [{ day: 0, templateId: p.template0 }];
  if (p.template1) steps.push({ day: p.day1, templateId: p.template1 });
  if (p.template2 && p.template1) steps.push({ day: p.day2, templateId: p.template2 });

  const db = getDb();
  const r = await createCampaign(db, userId, {
    name: p.name,
    jobId: p.jobId || null,
    contactIds: p.contactIds,
    steps,
    dailyCap: Math.min(p.dailyCap, config.CAMPAIGN_DAILY_CAP_MAX),
    spacingSec: p.spacingSec,
  });
  if (!r.ok) redirect(`/outreach/campaigns?error=${r.error.kind}`);
  await audit(db, { actorId: userId, action: "campaign.create", subjectType: "campaign", subjectId: r.value.campaignId, meta: { queued: r.value.queued, skipped: r.value.skipped } });
  redirect(`/outreach/campaigns/${r.value.campaignId}`);
}

async function transition(campaignId: string, status: "RUNNING" | "PAUSED" | "CANCELLED", action: string) {
  const { userId } = await requireUser();
  const id = uuid.parse(campaignId);
  const db = getDb();
  const ok = await setCampaignStatus(db, userId, id, status, status === "PAUSED" ? "paused by you" : null);
  if (ok) await audit(db, { actorId: userId, action, subjectType: "campaign", subjectId: id });
  revalidatePath(`/outreach/campaigns/${id}`);
  revalidatePath("/outreach/campaigns");
}

/** The one approval: everything queued goes out over the coming days inside the rails. */
export async function approveCampaignAction(campaignId: string): Promise<void> {
  await transition(campaignId, "RUNNING", "campaign.approve");
}
export async function pauseCampaignAction(campaignId: string): Promise<void> {
  await transition(campaignId, "PAUSED", "campaign.pause");
}
export async function resumeCampaignAction(campaignId: string): Promise<void> {
  await transition(campaignId, "RUNNING", "campaign.resume");
}
export async function cancelCampaignAction(campaignId: string): Promise<void> {
  await transition(campaignId, "CANCELLED", "campaign.cancel");
}
