import Link from "next/link";
import { z } from "zod";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@sifarish/db";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

async function count(db: ReturnType<typeof getDb>, q: Promise<Array<{ n: number }>>): Promise<number> {
  const [row] = await q;
  return row?.n ?? 0;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const { days } = query.parse({ days: (await searchParams).days });
  const db = getDb();
  const since = sql`now() - make_interval(days => ${days})`;
  const n = sql<number>`count(*)::int`;

  const [discovered, strong, alerted, opened, saved, queued, submitted, sent, replied, screening, interviews, offers] = await Promise.all([
    count(db, db.select({ n }).from(schema.jobs).where(gte(schema.jobs.firstSeenAt, since))),
    count(db, db.select({ n }).from(schema.jobMatches).innerJoin(schema.jobs, eq(schema.jobMatches.jobId, schema.jobs.id)).where(and(eq(schema.jobMatches.userId, userId), eq(schema.jobMatches.band, "strong"), gte(schema.jobs.firstSeenAt, since)))),
    count(db, db.select({ n }).from(schema.alerts).where(and(eq(schema.alerts.userId, userId), eq(schema.alerts.kind, "instant"), gte(schema.alerts.sentAt, since)))),
    count(db, db.select({ n: sql<number>`count(distinct job_id)::int` }).from(schema.userJobEvents).where(and(eq(schema.userJobEvents.userId, userId), eq(schema.userJobEvents.type, "OPEN"), gte(schema.userJobEvents.createdAt, since)))),
    count(db, db.select({ n: sql<number>`count(distinct job_id)::int` }).from(schema.userJobEvents).where(and(eq(schema.userJobEvents.userId, userId), eq(schema.userJobEvents.type, "SAVE"), gte(schema.userJobEvents.createdAt, since)))),
    count(db, db.select({ n }).from(schema.applyAttempts).where(and(eq(schema.applyAttempts.userId, userId), gte(schema.applyAttempts.createdAt, since)))),
    count(db, db.select({ n }).from(schema.applications).where(and(eq(schema.applications.userId, userId), sql`${schema.applications.appliedAt} >= ${since}`))),
    count(db, db.select({ n }).from(schema.outreachMessages).where(and(eq(schema.outreachMessages.userId, userId), inArray(schema.outreachMessages.status, ["SENT", "REPLIED", "BOUNCED"]), gte(schema.outreachMessages.createdAt, since)))),
    count(db, db.select({ n }).from(schema.outreachMessages).where(and(eq(schema.outreachMessages.userId, userId), eq(schema.outreachMessages.status, "REPLIED"), gte(schema.outreachMessages.createdAt, since)))),
    count(db, db.select({ n }).from(schema.applications).where(and(eq(schema.applications.userId, userId), eq(schema.applications.status, "SCREENING"), gte(schema.applications.updatedAt, since)))),
    count(db, db.select({ n }).from(schema.applications).where(and(eq(schema.applications.userId, userId), inArray(schema.applications.status, ["INTERVIEW", "FINAL_ROUND"]), gte(schema.applications.updatedAt, since)))),
    count(db, db.select({ n }).from(schema.applications).where(and(eq(schema.applications.userId, userId), eq(schema.applications.status, "OFFER"), gte(schema.applications.updatedAt, since)))),
  ]);

  const funnel = [
    ["Openings discovered", discovered],
    ["Strong matches", strong],
    ["Opened", opened],
    ["Saved", saved],
    ["Queued to apply", queued],
    ["Applications submitted", submitted],
    ["Screening", screening],
    ["Interviews", interviews],
    ["Offers", offers],
  ] as const;
  const max = Math.max(1, ...funnel.map(([, v]) => v));
  const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted">Where the pipeline leaks, in the last {days} days.</p>
        </div>
        <div className="flex gap-2 text-sm">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/analytics?days=${d}`} className={`rounded-full border px-3 py-1 ${d === days ? "border-ink bg-ink text-paper" : "border-line hover:bg-accent-soft"}`}>
              {d} days
            </Link>
          ))}
        </div>
      </div>

      <section aria-label="Headline numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Applications", submitted, `${queued} queued by the runner`],
            ["Instant alerts", alerted, `${strong} strong matches surfaced`],
            ["Outreach sent", sent, replyRate == null ? "no sends yet" : `${replyRate}% replied`],
            ["Interviews", interviews, `${offers} offer${offers === 1 ? "" : "s"}`],
          ] as const
        ).map(([label, value, sub]) => (
          <div key={label} className="card-surface p-4">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted">{sub}</p>
          </div>
        ))}
      </section>

      <section aria-label="Funnel" className="card-surface p-4">
        <h2 className="font-semibold">Funnel</h2>
        <p className="text-xs text-muted">One bar per stage; widths share one scale.</p>
        <ol className="mt-4 flex flex-col gap-2">
          {funnel.map(([label, value]) => (
            <li key={label} className="grid grid-cols-[11rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="truncate text-muted">{label}</span>
              <span className="h-2 overflow-hidden rounded-sm bg-accent-soft" role="img" aria-label={`${label}: ${value}`}>
                <span className="block h-full rounded-sm bg-accent" style={{ width: `${Math.max(value > 0 ? 2 : 0, (value / max) * 100)}%` }} />
              </span>
              <span className="text-right font-medium tabular-nums">{value}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card-surface p-4 text-sm">
        <h2 className="font-semibold">Reading it</h2>
        <p className="mt-2 text-muted">
          Discovered to strong is the matching engine; tune it on the Profile page. Strong to opened is whether alerts reach you. Opened to submitted is the runner and your daily cap. Submitted to screening is the market; outreach replies are the lever there. Everything above is computed from your own events and resets with the window.
        </p>
      </section>
    </div>
  );
}
