import Link from "next/link";
import { getDb, trackerRepo } from "@sifarish/db";
import { APPLICATION_STATUSES } from "@sifarish/db/repo/tracker";
import { requireUser } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import {
  changeStatusAction,
  addNoteAction,
  addReminderAction,
  completeReminderAction,
} from "./actions";

export const metadata = { title: "Tracker" };
export const dynamic = "force-dynamic";

export default async function TrackerPage() {
  const { userId } = await requireUser();
  const db = getDb();
  const [apps, reminders] = await Promise.all([
    trackerRepo.listApplications(db, userId),
    trackerRepo.dueReminders(db, userId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Tracker</h1>
        <p className="mt-1 text-sm text-muted">
          Every application, with the listing snapshot kept even if the company removes it.
        </p>
      </div>

      {reminders.length > 0 ? (
        <section className="rounded-xl border border-accent/40 bg-white p-4">
          <h2 className="font-semibold">Reminders</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {reminders.map((r) => {
              const overdue = r.dueAt.getTime() < Date.now();
              return (
                <li key={r.id} className="flex items-center gap-3 text-sm">
                  <span className={overdue ? "font-medium text-warn" : ""}>
                    {r.dueAt.toISOString().slice(0, 10)} — {r.message}
                  </span>
                  <form action={completeReminderAction.bind(null, r.id)} className="ml-auto">
                    <button
                      type="submit"
                      className="rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                    >
                      Done
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {apps.length === 0 ? (
        <EmptyState
          title="Nothing tracked yet"
          body='Open a job and hit "Mark applied", or send an outreach — contacted roles land here automatically.'
          action={
            <Link
              href="/jobs"
              className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
            >
              Browse jobs
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {apps.map((a) => (
            <article key={a.id} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/jobs/${a.jobId}`} className="font-semibold hover:underline">
                    {a.jobTitle}
                  </Link>
                  <p className="text-sm text-muted">
                    {a.companyName}
                    {a.jobStatus === "REMOVED" ? (
                      <span className="ml-2 text-warn">listing removed — snapshot kept</span>
                    ) : null}
                  </p>
                </div>
                <form action={changeStatusAction} className="flex items-center gap-2">
                  <input type="hidden" name="applicationId" value={a.id} />
                  <select
                    name="status"
                    defaultValue={a.status}
                    className="rounded-lg border border-line px-2 py-1.5 text-sm"
                    aria-label="Application status"
                  >
                    {APPLICATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll("_", " ").toLowerCase()}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
                  >
                    Update
                  </button>
                </form>
              </div>

              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">Notes & reminders</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <form action={addNoteAction} className="flex flex-col gap-2">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <textarea
                      name="body"
                      rows={2}
                      placeholder="Add a note…"
                      className="rounded-lg border border-line px-3 py-2"
                    />
                    <button
                      type="submit"
                      className="self-start rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                    >
                      Add note
                    </button>
                  </form>
                  <form action={addReminderAction} className="flex flex-col gap-2">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <input
                      name="message"
                      placeholder="Follow up…"
                      className="rounded-lg border border-line px-3 py-2"
                    />
                    <input
                      name="dueAt"
                      type="date"
                      required
                      className="rounded-lg border border-line px-3 py-2"
                    />
                    <button
                      type="submit"
                      className="self-start rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                    >
                      Add reminder
                    </button>
                  </form>
                </div>
                <NoteList applicationId={a.id} userId={userId} />
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

async function NoteList({ applicationId, userId }: { applicationId: string; userId: string }) {
  const rows = await trackerRepo.listNotes(getDb(), userId, "application", applicationId);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2">
      {rows.map((n) => (
        <li key={n.id} className="text-sm">
          <span className="text-muted">{n.createdAt.toISOString().slice(0, 10)}:</span> {n.body}
        </li>
      ))}
    </ul>
  );
}
