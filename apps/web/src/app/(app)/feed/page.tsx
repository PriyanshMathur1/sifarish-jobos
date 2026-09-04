import Link from "next/link";
import { z } from "zod";
import { getDb, matchesRepo, profilesRepo } from "@sifarish/db";
import { requireUser } from "@/lib/session";
import { freshnessLabel } from "@/lib/freshness";
import { EmptyState } from "@/components/empty-state";
import { MatchBadge } from "@/components/match-badge";
import { BookmarkIcon, XIcon } from "@/components/icons";
import { saveJob, unsaveJob, hideJob } from "../jobs/actions";

export const metadata = { title: "For you" };
export const dynamic = "force-dynamic";

const query = z.object({
  band: z.enum(["strong", "good", "maybe"]).default("good"),
  days: z.coerce.number().int().min(1).max(90).default(7),
});

const BANDS = [
  ["strong", "Strong"],
  ["good", "Good and up"],
  ["maybe", "Everything scored"],
] as const;
const WINDOWS = [
  [1, "Today"],
  [7, "7 days"],
  [30, "30 days"],
] as const;

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const q = query.parse({ band: sp.band, days: sp.days });
  const db = getDb();

  const [profile, items, counts] = await Promise.all([
    profilesRepo.getProfile(db, userId),
    matchesRepo.feedForUser(db, userId, { minBand: q.band, sinceDays: q.days, limit: 100 }),
    matchesRepo.bandCounts(db, userId, q.days),
  ]);

  const profileReady = Boolean(profile?.currentTitle || (profile?.skills.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[28px] tracking-tight">For you</h1>
        <p className="mt-1 text-sm text-muted">
          Every live opening scored against your profile. {counts.strong} strong, {counts.good} good,{" "}
          {counts.maybe} maybe in the last {q.days} day{q.days === 1 ? "" : "s"}.
        </p>
      </div>

      {!profileReady ? (
        <EmptyState
          title="Nothing to score against yet"
          body="Add your title and skills so the engine has something to compare each opening with."
          action={
            <Link href="/profile" className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90">
              Fill in your profile
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Show</span>
            {BANDS.map(([value, label]) => (
              <Chip key={value} href={`/feed?band=${value}&days=${q.days}`} active={q.band === value}>
                {label}
              </Chip>
            ))}
            <span className="ml-3 text-muted">from</span>
            {WINDOWS.map(([value, label]) => (
              <Chip key={value} href={`/feed?band=${q.band}&days=${value}`} active={q.days === value}>
                {label}
              </Chip>
            ))}
          </div>

          {items.length === 0 ? (
            <EmptyState
              title="No matches in this window"
              body="Widen the window or lower the band. Scores refresh with every crawl, and instantly when you change your profile."
              action={
                <Link href="/feed?band=maybe&days=30" className="rounded-lg border border-line px-4 py-2 hover:bg-accent-soft">
                  Show everything from 30 days
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((job) => (
                <li key={job.id}>
                  <FeedCard job={job} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 ${
        active ? "border-ink bg-ink text-paper" : "border-line hover:bg-accent-soft"
      }`}
    >
      {children}
    </Link>
  );
}

function FeedCard({ job }: { job: matchesRepo.FeedItem }) {
  const meta = [job.locations.slice(0, 2).join(" · ") || null, job.remoteType].filter(Boolean).join(" · ");
  return (
    <article className="rounded-xl border border-line bg-white p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{job.companyName}</p>
            <MatchBadge score={job.score} band={job.band} />
          </div>
          <Link href={`/jobs/${job.id}`} className="mt-1 block truncate font-semibold hover:underline">
            {job.title}
          </Link>
          <p className="mt-1 truncate text-sm text-muted">{meta}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <form action={job.saved ? unsaveJob.bind(null, job.id) : saveJob.bind(null, job.id)}>
            <button
              type="submit"
              aria-label={job.saved ? "Unsave job" : "Save job"}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${
                job.saved ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-accent-soft"
              }`}
            >
              <BookmarkIcon className="h-3.5 w-3.5" />
              {job.saved ? "Saved" : "Save"}
            </button>
          </form>
          <form action={hideJob.bind(null, job.id, undefined)}>
            <button
              type="submit"
              aria-label="Hide job"
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:bg-paper"
            >
              <XIcon className="h-3.5 w-3.5" />
              Hide
            </button>
          </form>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {job.reasons.slice(0, 4).map((r) => (
          <li key={r} className="before:mr-1.5 before:content-['·']">
            {r}
          </li>
        ))}
        <li className="ml-auto">{freshnessLabel(job.sourcePostedAt, job.firstSeenAt)}</li>
      </ul>
    </article>
  );
}
