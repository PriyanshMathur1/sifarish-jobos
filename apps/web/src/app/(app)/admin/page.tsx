import { desc, sql } from "drizzle-orm";
import { getDb, schema, jobsRepo } from "@sifarish/db";
import { requireAdmin } from "@/lib/session";
import { runGlobalRefresh, refreshOneCompany, toggleCompanyStatus, toggleCompanyPriority } from "./actions";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { userId } = await requireAdmin();
  const db = getDb();

  const [companies, runs, errors, [counts]] = await Promise.all([
    jobsRepo.listCompanies(db),
    db.select().from(schema.refreshRuns).orderBy(desc(schema.refreshRuns.scheduledAt)).limit(10),
    db.select().from(schema.crawlErrors).orderBy(desc(schema.crawlErrors.createdAt)).limit(10),
    db
      .select({
        active: sql<number>`count(*) filter (where status = 'ACTIVE')::int`,
        unknown: sql<number>`count(*) filter (where status = 'UNKNOWN')::int`,
        removed: sql<number>`count(*) filter (where status = 'REMOVED')::int`,
      })
      .from(schema.jobs),
  ]);
  void userId;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] tracking-tight">Admin</h1>
        <form action={runGlobalRefresh}>
          <button
            type="submit"
            className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
          >
            Refresh all sources now
          </button>
        </form>
      </div>

      <section aria-label="Job counts" className="grid grid-cols-3 gap-3">
        {(
          [
            ["Active jobs", counts?.active ?? 0],
            ["Unknown (strike 1)", counts?.unknown ?? 0],
            ["Removed", counts?.removed ?? 0],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-4">
            <p className="text-2xl font-semibold">{n}</p>
            <p className="text-sm text-muted">{label}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="font-semibold">Sources ({companies.length})</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Open jobs</th>
                <th className="px-3 py-2">Last success</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2 text-muted">{c.atsProvider}</td>
                  <td className="px-3 py-2">{c.openJobs}</td>
                  <td className="px-3 py-2 text-muted">
                    {c.lastSuccessfulCheckAt
                      ? c.lastSuccessfulCheckAt.toISOString().slice(0, 16).replace("T", " ")
                      : "never"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={c.status === "ACTIVE" ? "text-good" : "text-warn"}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <form action={toggleCompanyPriority.bind(null, c.id)}>
                      <button
                        type="submit"
                        title={c.priority === "watch" ? "Refreshed every 15 minutes. Click for hourly." : "Refreshed hourly. Click to watch every 15 minutes."}
                        className={`rounded border px-2 py-1 text-xs ${
                          c.priority === "watch" ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-accent-soft"
                        }`}
                      >
                        {c.priority === "watch" ? "Watching" : "Hourly"}
                      </button>
                    </form>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <form action={refreshOneCompany.bind(null, c.id)}>
                        <button
                          type="submit"
                          className="rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                        >
                          Refresh
                        </button>
                      </form>
                      <form action={toggleCompanyStatus.bind(null, c.id)}>
                        <button
                          type="submit"
                          className="rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                        >
                          {c.status === "ACTIVE" ? "Pause" : "Resume"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Refresh runs</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-3 py-2">Scheduled</th>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Companies</th>
                <th className="px-3 py-2">New</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Removed</th>
                <th className="px-3 py-2">Rejected (market)</th>
                <th className="px-3 py-2">Errors</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-center text-muted">
                    No runs yet — the twice-daily schedule or "Refresh all sources now" creates one.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">
                      {r.scheduledAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2 text-muted">{r.trigger}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">{r.companiesProcessed}</td>
                    <td className="px-3 py-2">{r.jobsNew}</td>
                    <td className="px-3 py-2">{r.jobsUpdated}</td>
                    <td className="px-3 py-2">{r.jobsRemoved}</td>
                    <td className="px-3 py-2">{r.jobsRejectedMarket}</td>
                    <td className="px-3 py-2">{r.errors}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Recent crawl errors</h2>
        {errors.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None recorded.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {errors.map((e) => (
              <li key={e.id} className="rounded-lg border border-line bg-white px-3 py-2">
                <span className="text-muted">
                  {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </span>{" "}
                <span className="font-medium">{e.provider}</span> · {e.stage} ·{" "}
                <span className="text-warn">{e.error.slice(0, 140)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
