import Link from "next/link";
import { z } from "zod";
import { desc, eq, inArray, sql, and } from "drizzle-orm";
import { getDb, schema, campaignsRepo } from "@sifarish/db";
import { loadConfig } from "@sifarish/core";
import { requireUser } from "@/lib/session";
import { getGmailStatus } from "@/lib/gmail";
import { createCampaignAction } from "../actions";

export const metadata = { title: "New campaign" };
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const MAX = 200;

function asList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const contactIds = [...new Set(asList(sp.c).filter((id) => uuid.safeParse(id).success))].slice(0, MAX);
  const preJob = typeof sp.job === "string" && uuid.safeParse(sp.job).success ? sp.job : "";
  const config = loadConfig();
  const db = getDb();
  const gmail = await getGmailStatus(userId);

  const [contacts, jobRows, templateRows, sentToday] = await Promise.all([
    contactIds.length
      ? db
          .select({ id: schema.contacts.id, fullName: schema.contacts.fullName, email: schema.contacts.businessEmail, company: schema.companies.name })
          .from(schema.contacts)
          .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
          .where(and(eq(schema.contacts.userId, userId), inArray(schema.contacts.id, contactIds)))
      : Promise.resolve([]),
    db
      .select({ id: schema.jobs.id, title: schema.jobs.title, company: schema.companies.name })
      .from(schema.jobs)
      .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
      .where(eq(schema.jobs.status, "ACTIVE"))
      .orderBy(desc(schema.jobs.firstSeenAt))
      .limit(200),
    db
      .select({ id: schema.templates.id, name: schema.templates.name, kind: schema.templates.kind })
      .from(schema.templates)
      .where(sql`(${schema.templates.userId} = ${userId} or ${schema.templates.isBuiltin} = true)`)
      .orderBy(desc(schema.templates.isBuiltin)),
    campaignsRepo.sentToday(db, userId),
  ]);

  const intro = templateRows.filter((t) => t.kind !== "followup");
  const followups = templateRows.filter((t) => t.kind === "followup");

  if (!config.OUTREACH_DIRECT_SEND) {
    return (
      <Blocked title="Campaigns are off on this deployment">
        Set <code className="rounded bg-accent-soft px-1">OUTREACH_DIRECT_SEND=true</code> in the server
        environment, then reconnect Gmail so the send and metadata permissions are granted. Until
        then, bulk drafting still works from the Contacts page.
      </Blocked>
    );
  }
  if (!gmail.connected) {
    return (
      <Blocked title="Connect Gmail first">
        Campaigns send from your own mailbox. <Link href="/profile" className="underline">Connect it on the Profile page</Link>, then come back.
      </Blocked>
    );
  }
  if (contacts.length === 0) {
    return (
      <Blocked title="No contacts selected">
        Go to <Link href="/contacts" className="underline">Contacts</Link>, tick the people with a known email, and choose "Start campaign".
      </Blocked>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/contacts" className="text-sm text-muted hover:underline">Back to contacts</Link>
      <h1 className="font-display mt-2 text-2xl tracking-tight">New campaign: {contacts.length} people</h1>
      <p className="mt-1 text-sm text-muted">
        One approval, then Sifarish sends from your Gmail a few at a time. Today: {sentToday} sent, hard ceiling {config.CAMPAIGN_DAILY_CAP_MAX} per day,
        at most {config.CAMPAIGN_PER_COMPANY_14D} people per company per two weeks, first week capped at {config.CAMPAIGN_WARMUP_DAILY_CAP} a day.
      </p>

      <form action={createCampaignAction} className="mt-6 flex flex-col gap-5">
        {contacts.map((c) => (
          <input key={c.id} type="hidden" name="c" value={c.id} />
        ))}

        <div className="card-surface p-4">
          <h2 className="font-semibold">Who</h2>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {contacts.map((c) => (
              <li key={c.id} className="truncate">
                {c.fullName} <span className="text-muted">{c.company ? `· ${c.company}` : ""} {c.email ? "" : "(no email, will be skipped)"}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card-surface flex flex-col gap-4 p-4">
          <h2 className="font-semibold">What</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Campaign name
            <input name="name" required defaultValue={`Outreach ${new Date().toISOString().slice(0, 10)}`} className="rounded-lg border border-line bg-white px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            About which opening (fills job variables in the templates)
            <select name="jobId" defaultValue={preJob} className="rounded-lg border border-line bg-white px-3 py-2 font-normal">
              <option value="">No specific job (template must not use job variables)</option>
              {jobRows.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.company}: {j.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            First message
            <select name="template0" required className="rounded-lg border border-line bg-white px-3 py-2 font-normal">
              {intro.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <StepPicker label="Follow-up 1 (optional)" nameT="template1" nameD="day1" day={4} templates={followups} />
            <StepPicker label="Follow-up 2 (optional)" nameT="template2" nameD="day2" day={6} templates={followups} />
          </div>
          <p className="text-xs text-muted">
            Follow-ups reply in the same thread and stop the moment someone replies or an address bounces. An unsubscribe line is appended to every first message.
          </p>
        </div>

        <div className="card-surface flex flex-wrap items-end gap-4 p-4">
          <h2 className="w-full font-semibold">How fast</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Per day
            <input name="dailyCap" type="number" min={1} max={config.CAMPAIGN_DAILY_CAP_MAX} defaultValue={40} className="w-28 rounded-lg border border-line bg-white px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Seconds between sends
            <input name="spacingSec" type="number" min={30} max={3600} defaultValue={120} className="w-28 rounded-lg border border-line bg-white px-3 py-2 font-normal" />
          </label>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper hover:opacity-90">
            Create and review
          </button>
          <Link href="/contacts" className="rounded-lg border border-line px-5 py-2.5 hover:bg-accent-soft">Cancel</Link>
        </div>
      </form>
    </div>
  );
}

function StepPicker({ label, nameT, nameD, day, templates }: { label: string; nameT: string; nameD: string; day: number; templates: Array<{ id: string; name: string }> }) {
  return (
    <div className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <div className="flex gap-2">
        <select name={nameT} defaultValue="" className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 font-normal">
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 font-normal text-muted">
          after
          <input name={nameD} type="number" min={1} max={30} defaultValue={day} className="w-14 rounded-lg border border-line bg-white px-2 py-2" />
          d
        </label>
      </div>
    </div>
  );
}

function Blocked({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/contacts" className="text-sm text-muted hover:underline">Back to contacts</Link>
      <h1 className="font-display mt-2 text-2xl tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">{children}</p>
    </div>
  );
}
