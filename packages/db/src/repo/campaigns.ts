import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { campaignRecipients, campaigns, companies, contacts, jobs, outreachMessages } from "../schema/index.ts";

/** Campaign reads for the UI. Writes live in @sifarish/core (outreach/campaigns.ts). */

export async function listCampaigns(db: Db, userId: string) {
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      pauseReason: campaigns.pauseReason,
      jobTitle: jobs.title,
      steps: campaigns.steps,
      createdAt: campaigns.createdAt,
      total: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id})`,
      sent: sql<number>`(select count(*)::int from outreach_messages m where m.campaign_id = ${campaigns.id} and m.status in ('SENT','REPLIED','BOUNCED'))`,
      replied: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id} and r.state = 'REPLIED')`,
      pending: sql<number>`(select count(*)::int from campaign_recipients r where r.campaign_id = ${campaigns.id} and r.state in ('QUEUED','WAITING'))`,
    })
    .from(campaigns)
    .leftJoin(jobs, eq(campaigns.jobId, jobs.id))
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
}

export async function getCampaign(db: Db, userId: string, campaignId: string) {
  const [row] = await db
    .select({ campaign: campaigns, jobTitle: jobs.title, jobCompany: companies.name })
    .from(campaigns)
    .leftJoin(jobs, eq(campaigns.jobId, jobs.id))
    .leftJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  if (!row) return null;

  const recipients = await db
    .select({
      id: campaignRecipients.id,
      contactId: campaignRecipients.contactId,
      fullName: contacts.fullName,
      title: contacts.title,
      email: contacts.businessEmail,
      companyName: companies.name,
      step: campaignRecipients.step,
      state: campaignRecipients.state,
      nextAt: campaignRecipients.nextAt,
      skipReason: campaignRecipients.skipReason,
      lastSentAt: sql<Date | null>`(select max(sent_at) from outreach_messages m where m.campaign_id = ${campaigns.id} and m.contact_id = ${contacts.id})`,
    })
    .from(campaignRecipients)
    .innerJoin(contacts, eq(campaignRecipients.contactId, contacts.id))
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .innerJoin(campaigns, eq(campaignRecipients.campaignId, campaigns.id))
    .where(eq(campaignRecipients.campaignId, campaignId))
    .orderBy(campaignRecipients.state, contacts.fullName);

  return { ...row, recipients };
}

/** Today's send count for the cap readout. */
export async function sentToday(db: Db, userId: string): Promise<number> {
  const [row] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachMessages)
    .where(
      and(
        eq(outreachMessages.userId, userId),
        eq(outreachMessages.mode, "send"),
        sql`${outreachMessages.status} in ('PREPARED','SENT','REPLIED','BOUNCED')`,
        sql`${outreachMessages.createdAt} >= date_trunc('day', now())`,
      ),
    )) as [{ n: number }];
  return row.n;
}
