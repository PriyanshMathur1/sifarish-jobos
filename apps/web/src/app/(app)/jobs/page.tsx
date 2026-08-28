import { z } from "zod";
import { getDb, jobsRepo } from "@jobos/db";
import { requireUser } from "@/lib/session";
import { JobCard } from "@/components/job-card";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  q: z.string().max(200).optional(),
  remote: z.enum(["remote", "hybrid", "onsite"]).optional(),
  company: z.string().uuid().optional(),
  market: z.enum(["IN_CONFIRMED", "REMOTE_UNVERIFIED"]).optional(),
  etype: z.string().max(40).optional(),
  fresh: z.coerce.number().int().positive().max(365).optional(),
  saved: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const raw = await searchParams;
  // A GET form submits every field — empty strings mean "unset", and must
  // not fail enum parsing (which would silently drop ALL filters).
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== "" && v !== undefined),
  );
  const parsed = paramsSchema.safeParse(cleaned);
  const p = parsed.success ? parsed.data : paramsSchema.parse({});

  const db = getDb();
  const [{ items, total }, companies] = await Promise.all([
    jobsRepo.searchJobs(db, userId, {
      ...(p.q ? { q: p.q } : {}),
      ...(p.remote ? { remote: p.remote } : {}),
      ...(p.market ? { market: p.market } : {}),
      ...(p.etype ? { employmentType: p.etype } : {}),
      ...(p.company ? { companyId: p.company } : {}),
      ...(p.fresh ? { freshDays: p.fresh } : {}),
      ...(p.saved ? { savedOnly: true } : {}),
      page: p.page,
    }),
    jobsRepo.listCompanies(db),
  ]);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <p className="text-sm text-muted">
          {total} opening{total === 1 ? "" : "s"} · India market
        </p>
      </div>

      <form method="GET" className="mt-4 flex flex-wrap items-end gap-2">
        <input
          type="search"
          name="q"
          defaultValue={p.q ?? ""}
          placeholder="Search title, skill, company…"
          className="min-w-52 flex-1 rounded-lg border border-line bg-white px-3 py-2"
          aria-label="Search jobs"
        />
        <select
          name="remote"
          defaultValue={p.remote ?? ""}
          className="rounded-lg border border-line bg-white px-2 py-2 text-sm"
          aria-label="Work mode"
        >
          <option value="">Any mode</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">Onsite</option>
        </select>
        <select
          name="company"
          defaultValue={p.company ?? ""}
          className="max-w-44 rounded-lg border border-line bg-white px-2 py-2 text-sm"
          aria-label="Company"
        >
          <option value="">Any company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.openJobs})
            </option>
          ))}
        </select>
        <select
          name="market"
          defaultValue={p.market ?? ""}
          className="rounded-lg border border-line bg-white px-2 py-2 text-sm"
          aria-label="Market eligibility"
        >
          <option value="">Any eligibility</option>
          <option value="IN_CONFIRMED">India confirmed</option>
          <option value="REMOTE_UNVERIFIED">Remote (unverified)</option>
        </select>
        <select
          name="fresh"
          defaultValue={p.fresh?.toString() ?? ""}
          className="rounded-lg border border-line bg-white px-2 py-2 text-sm"
          aria-label="Freshness"
        >
          <option value="">Any age</option>
          <option value="1">Last 24h</option>
          <option value="7">Last week</option>
          <option value="30">Last month</option>
        </select>
        <label className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <input type="checkbox" name="saved" value="true" defaultChecked={Boolean(p.saved)} />
          Saved only
        </label>
        <button
          type="submit"
          className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
        >
          Search
        </button>
      </form>

      {items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={p.q || p.remote || p.company ? "No jobs match these filters" : "No jobs yet"}
            body={
              p.q || p.remote || p.company
                ? "Try broadening the search — clear a filter or use a shorter query."
                : "Run a refresh (Admin → Refresh now) to pull live openings from the company boards, or re-seed dev data."
            }
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {total > 25 ? (
        <div className="mt-6 flex justify-center gap-2 text-sm">
          {p.page > 1 ? (
            <a
              className="rounded-md border border-line px-3 py-1.5 hover:bg-accent-soft"
              href={`?${new URLSearchParams({ ...raw, page: String(p.page - 1) } as Record<string, string>)}`}
            >
              Previous
            </a>
          ) : null}
          {p.page * 25 < total ? (
            <a
              className="rounded-md border border-line px-3 py-1.5 hover:bg-accent-soft"
              href={`?${new URLSearchParams({ ...raw, page: String(p.page + 1) } as Record<string, string>)}`}
            >
              Next
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
