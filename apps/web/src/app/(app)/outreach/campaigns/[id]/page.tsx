import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb, campaignsRepo } from "@sifarish/db";
import { requireUser } from "@/lib/session";
import { approveCampaignAction, pauseCampaignAction, resumeCampaignAction, cancelCampaignAction } from "../actions";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  WAITING: "Waiting for follow-up",
  DONE: "Done",
  SKIPPED: "Skipped",
  BOUNCED: "Bounced",
  REPLIED: "Replied",
  FAILED: "Failed",
  STOPPED: "Stopped",
};

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const row = await campaignsRepo.getCampaign(getDb(), userId, id);
  if (!row) notFound();
  const { campaign, recipients, jobTitle, jobCompany } = row;

  const counts = recipients.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});
  const sendable = (counts.QUEUED ?? 0) + (counts.WAITING ?? 0);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/outreach/campaigns" className="text-sm text-muted hover:underline">All campaigns</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl tracking-tight">{campaign.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {jobTitle ? `About ${jobTitle} at ${jobCompany}. ` : ""}
            {campaign.steps.length} step{campaign.steps.length === 1 ? "" : "s"}, {campaign.dailyCap}/day, {campaign.spacingSec}s apart.
          </p>
        </div>
        <StatusPill status={campaign.status} reason={campaign.pauseReason} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {campaign.status === "DRAFT" ? (
          <form action={approveCampaignAction.bind(null, campaign.id)}>
            <button type="submit" disabled={sendable === 0} className="rounded-lg bg-ink px-5 py-2.5 font-medium text-paper hover:opacity-90 disabled:opacity-40">
              Approve: send to {sendable} {sendable === 1 ? "person" : "people"}
            </button>
          </form>
        ) : null}
        {campaign.status === "RUNNING" ? (
          <form action={pauseCampaignAction.bind(null, campaign.id)}>
            <button type="submit" className="rounded-lg border border-line px-4 py-2 hover:bg-accent-soft">Pause</button>
          </form>
        ) : null}
        {campaign.status === "PAUSED" ? (
          <form action={resumeCampaignAction.bind(null, campaign.id)}>
            <button type="submit" className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90">Resume</button>
          </form>
        ) : null}
        {campaign.status === "DRAFT" || campaign.status === "RUNNING" || campaign.status === "PAUSED" ? (
          <form action={cancelCampaignAction.bind(null, campaign.id)}>
            <button type="submit" className="rounded-lg border border-line px-4 py-2 text-warn hover:bg-accent-soft">Cancel remaining</button>
          </form>
        ) : null}
      </div>

      <section aria-label="Progress" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Pending", sendable],
            ["Replied", counts.REPLIED ?? 0],
            ["Bounced", counts.BOUNCED ?? 0],
            ["Skipped", (counts.SKIPPED ?? 0) + (counts.FAILED ?? 0) + (counts.STOPPED ?? 0)],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="card-surface p-3">
            <p className="text-2xl font-semibold tabular-nums">{n}</p>
            <p className="text-sm text-muted">{label}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Step</th>
              <th className="px-3 py-2">Last sent</th>
              <th className="px-3 py-2">Next</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/contacts/${r.contactId}`} className="font-medium hover:underline">{r.fullName}</Link>
                  <span className="block text-xs text-muted">{r.email ?? "no email"}</span>
                </td>
                <td className="px-3 py-2">{r.companyName ?? ""}</td>
                <td className="px-3 py-2">
                  <span className={r.state === "REPLIED" ? "text-good" : r.state === "BOUNCED" || r.state === "FAILED" ? "text-warn" : ""}>
                    {STATE_LABEL[r.state] ?? r.state}
                  </span>
                  {r.skipReason ? <span className="block text-xs text-muted">{r.skipReason}</span> : null}
                </td>
                <td className="px-3 py-2 tabular-nums">{Math.min(r.step, campaign.steps.length)}/{campaign.steps.length}</td>
                <td className="px-3 py-2 text-muted">{r.lastSentAt ? new Date(r.lastSentAt).toISOString().slice(0, 10) : ""}</td>
                <td className="px-3 py-2 text-muted">{r.nextAt && (r.state === "WAITING" || r.state === "QUEUED") ? r.nextAt.toISOString().slice(0, 10) : r.state === "QUEUED" ? "next tick" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status, reason }: { status: string; reason: string | null }) {
  const cls =
    status === "RUNNING" ? "bg-accent text-paper" : status === "PAUSED" ? "border border-warn text-warn" : status === "DONE" ? "border border-good text-good" : "border border-line text-muted";
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-medium ${cls}`} title={reason ?? undefined}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
      {reason ? `: ${reason}` : ""}
    </span>
  );
}
