import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb, jobsRepo } from "@sifarish/db";
import { requireUser } from "@/lib/session";
import { freshnessLabel } from "@/lib/freshness";
import Link from "next/link";
import { saveJob, unsaveJob, hideJob } from "../actions";
import { markAppliedAction } from "../../tracker/actions";
import { ExternalLinkIcon, CheckIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const db = getDb();
  const row = await jobsRepo.getJobDetail(db, userId, id);
  if (!row) notFound();
  const { job, companyName, companyIndustry, saved } = row;

  // OPEN event (PRD §51) — deduped hourly so revalidations don't inflate it.
  await jobsRepo.recordOpenOnce(db, userId, job.id);

  const meta = [job.locations.join(" · ") || null, job.remoteType, job.employmentType]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="mx-auto max-w-3xl">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-muted">
          {companyName}
          {companyIndustry ? ` · ${companyIndustry}` : ""}
        </p>
        <h1 className="font-display mt-1 text-[30px] tracking-tight">{job.title}</h1>
        <p className="mt-2 text-sm text-muted">{meta}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">{freshnessLabel(job.sourcePostedAt, job.firstSeenAt)}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-muted">
            Source: {job.sourceProvider}
          </span>
          {job.marketEligibility === "REMOTE_UNVERIFIED" ? (
            <span className="rounded-full border border-warn/40 px-2 py-0.5 text-warn">
              Remote — eligibility unverified
            </span>
          ) : null}
          {job.status !== "ACTIVE" ? (
            <span className="rounded-full border border-warn/40 px-2 py-0.5 text-warn">
              {job.status === "REMOVED" ? "No longer listed at source" : "May no longer be listed"}
            </span>
          ) : null}
          {job.salaryMin && job.salaryMax ? (
            <span className="rounded-full border border-line px-2 py-0.5 text-muted">
              {job.salaryCurrency} {job.salaryMin.toLocaleString()}–{job.salaryMax.toLocaleString()}
              {job.salaryPeriod ? ` / ${job.salaryPeriod.toLowerCase()}` : ""}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {job.applyUrl ? (
            <a
              href={job.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
            >
              Apply at source
              <ExternalLinkIcon className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <form action={saved ? unsaveJob.bind(null, job.id) : saveJob.bind(null, job.id)}>
            <button
              type="submit"
              className={`rounded-lg border px-4 py-2 font-medium ${
                saved
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line hover:bg-accent-soft"
              }`}
            >
              {saved ? "Saved ✓" : "Save"}
            </button>
          </form>
          <form action={markAppliedAction.bind(null, job.id)}>
            <button
              type="submit"
              className="flex items-center gap-2 rounded-lg border border-good px-4 py-2 font-medium text-good hover:bg-good hover:text-paper"
            >
              <CheckIcon className="h-3.5 w-3.5" />
              Mark applied
            </button>
          </form>
          <Link
            href={`/outreach/new?job=${job.id}`}
            className="rounded-lg border border-accent px-4 py-2 font-medium text-accent hover:bg-accent-soft"
          >
            Compose outreach
          </Link>
          <form action={hideJob.bind(null, job.id, undefined)}>
            <button
              type="submit"
              className="rounded-lg border border-line px-4 py-2 text-muted hover:bg-paper"
            >
              Hide
            </button>
          </form>
        </div>
      </header>

      <hr className="my-6 border-line" />

      {job.descriptionHtml ? (
        <div
          className="prose-sifarish max-w-none text-[15px] leading-relaxed [&_a]:text-accent [&_a]:underline [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3"
          // Sanitized once at ingest (SPEC §5); stored HTML is already safe.
          dangerouslySetInnerHTML={{ __html: job.descriptionHtml }}
        />
      ) : (
        <p className="text-muted">
          The source did not provide a description. Open the original posting for details.
        </p>
      )}

      <footer className="mt-8 border-t border-line pt-4 text-xs text-muted">
        <p>
          Listing v{job.version}, observed by Sifarish{" "}
          {freshnessLabel(null, job.firstSeenAt).toLowerCase()}.
          {job.sourceUrl ? (
            <>
              {" "}
              Original:{" "}
              <a
                className="underline"
                href={job.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {new URL(job.sourceUrl).hostname}
              </a>
            </>
          ) : null}
        </p>
      </footer>
    </article>
  );
}
