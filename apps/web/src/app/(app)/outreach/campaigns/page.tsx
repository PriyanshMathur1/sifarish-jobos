import Link from "next/link";
import { getDb, campaignsRepo } from "@sifarish/db";
import { loadConfig } from "@sifarish/core";
import { requireUser } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  rate_limited: "Too many campaigns created in a short burst. Wait a minute.",
  no_steps: "Pick at least a first message template.",
  no_recipients: "No contacts were selected.",
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const config = loadConfig();
  const [rows, sentToday] = await Promise.all([campaignsRepo.listCampaigns(db, userId), campaignsRepo.sentToday(db, userId)]);
  const error = typeof sp.error === "string" ? (ERROR_COPY[sp.error] ?? sp.error) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">
            Approve once, send over days. {sentToday} sent today; ceiling {config.CAMPAIGN_DAILY_CAP_MAX}.
            {config.OUTREACH_DIRECT_SEND ? "" : " Direct send is off on this deployment."}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/outreach" className="rounded-lg border border-line px-3 py-1.5 hover:bg-accent-soft">Message log</Link>
          <Link href="/contacts" className="rounded-lg bg-ink px-3 py-1.5 font-medium text-paper hover:opacity-90">Pick contacts</Link>
        </div>
      </div>

      {error ? <p className="rounded-lg border border-warn/40 bg-white px-3 py-2 text-sm text-warn">{error}</p> : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body="Select contacts on the Contacts page and choose Start campaign. You approve the batch once; the sends and follow-ups run on their own."
          action={<Link href="/contacts" className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90">Go to contacts</Link>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/outreach/campaigns/${c.id}`} className="card-surface block p-4 transition-shadow hover:shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-muted">
                      {c.jobTitle ? `${c.jobTitle} · ` : ""}
                      {c.steps.length} step{c.steps.length === 1 ? "" : "s"} · created {c.createdAt.toISOString().slice(0, 10)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${c.status === "RUNNING" ? "bg-accent text-paper" : c.status === "PAUSED" ? "border border-warn text-warn" : "border border-line text-muted"}`}>
                    {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                  </span>
                </div>
                <p className="mt-2 text-sm tabular-nums text-muted">
                  {c.total} people · {c.sent} sent · {c.replied} replied · {c.pending} pending
                  {c.pauseReason ? ` · ${c.pauseReason}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
