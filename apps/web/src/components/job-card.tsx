import Link from "next/link";
import type { jobsRepo } from "@sifarish/db";
import { freshnessLabel } from "@/lib/freshness";
import { saveJob, unsaveJob, hideJob } from "@/app/(app)/jobs/actions";

/** Job card (PRD §58): company, role, location · mode, freshness, save/hide. */
export function JobCard({ job }: { job: jobsRepo.JobListItem }) {
  const meta = [job.locations.slice(0, 2).join(" · ") || null, job.remoteType, job.employmentType]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {job.companyName}
          </p>
          <Link
            href={`/jobs/${job.id}`}
            className="mt-0.5 block truncate font-semibold hover:underline"
          >
            {job.title}
          </Link>
          <p className="mt-1 truncate text-sm text-muted">{meta}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <form action={job.saved ? unsaveJob.bind(null, job.id) : saveJob.bind(null, job.id)}>
            <button
              type="submit"
              aria-label={job.saved ? "Unsave job" : "Save job"}
              className={`rounded-md border px-2.5 py-1 text-sm ${
                job.saved
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line hover:bg-accent-soft"
              }`}
            >
              {job.saved ? "Saved" : "Save"}
            </button>
          </form>
          <form action={hideJob.bind(null, job.id, undefined)}>
            <button
              type="submit"
              aria-label="Hide job"
              className="rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:bg-paper"
            >
              Hide
            </button>
          </form>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">{freshnessLabel(job.sourcePostedAt, job.firstSeenAt)}</span>
        {job.marketEligibility === "REMOTE_UNVERIFIED" ? (
          <span className="rounded-full border border-warn/40 px-2 py-0.5 text-warn">
            Remote — eligibility unverified
          </span>
        ) : null}
        {job.status === "UNKNOWN" ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-muted">
            May no longer be listed
          </span>
        ) : null}
      </div>
    </article>
  );
}
