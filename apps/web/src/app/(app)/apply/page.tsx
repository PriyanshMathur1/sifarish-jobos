import Link from "next/link";
import { getDb, applyRepo, profilesRepo } from "@sifarish/db";
import { loadConfig } from "@sifarish/core";
import { requireUser } from "@/lib/session";
import { MatchBadge } from "@/components/match-badge";
import {
  updateApplyRules,
  requeueAttempt,
  skipAttempt,
  answerAndRequeue,
  createDeviceTokenAction,
  revokeDeviceTokenAction,
} from "./actions";

export const metadata = { title: "Apply" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  SUBMITTED: "Submitted",
  BLOCKED: "Needs you",
  FAILED: "Failed",
  SKIPPED: "Skipped",
  CANCELLED: "Cancelled",
};

const BLOCKER_COPY: Record<string, string> = {
  captcha: "The form showed a CAPTCHA. Open it and finish by hand; the runner never solves those.",
  login_wall: "The form wants an account. Apply by hand for this one.",
  unknown_question: "The form asked something not in your answer bank.",
  unsupported: "This form family is not supported yet. Apply by hand.",
  no_resume: "No default resume is uploaded on your Profile page.",
  removed: "The listing disappeared before the runner got to it.",
  timeout: "You did not confirm within the wait window. Requeue to try again.",
  error: "Something broke on the page. Requeue once; if it repeats, apply by hand.",
};

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const freshToken = typeof sp.token === "string" ? sp.token : null;
  const db = getDb();
  const config = loadConfig();
  const [rules, attempts, tokens, resumes, done] = await Promise.all([
    applyRepo.getRules(db, userId),
    applyRepo.listAttempts(db, userId),
    applyRepo.listDeviceTokens(db, userId),
    profilesRepo.listResumes(db, userId),
    applyRepo.submittedToday(db, userId),
  ]);
  const hasResume = resumes.some((r) => r.isDefault);
  const blocked = attempts.filter((a) => a.status === "BLOCKED");
  const rest = attempts.filter((a) => a.status !== "BLOCKED");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[28px] tracking-tight">Apply</h1>
        <p className="mt-1 text-sm text-muted">
          Strong matches queue here on their own. The runner on your computer opens each hosted form
          in your own browser, fills it from your profile, resume and answer bank, and either waits
          for one click or submits. {done} submitted today, cap {rules.dailyCap}.
        </p>
      </div>

      {!hasResume ? (
        <p className="rounded-lg border border-warn/40 bg-white px-4 py-3 text-sm text-warn">
          No default resume yet. <Link href="/profile" className="underline">Upload one on your Profile</Link>; the runner cannot submit without it.
        </p>
      ) : null}

      {freshToken ? (
        <section className="rounded-xl border border-accent bg-white p-4">
          <h2 className="font-semibold">Your new device token (shown once)</h2>
          <p className="mt-1 text-sm text-muted">Paste it into the runner's .env as SIFARISH_DEVICE_TOKEN. It will not be shown again.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-paper p-3 font-mono text-sm">{freshToken}</pre>
        </section>
      ) : null}

      {blocked.length > 0 ? (
        <section>
          <h2 className="font-display text-xl tracking-tight">Needs you ({blocked.length})</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {blocked.map((a) => (
              <li key={a.id} className="card-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">{a.companyName}</p>
                    <Link href={`/jobs/${a.jobId}`} className="font-semibold hover:underline">{a.jobTitle}</Link>
                    <p className="mt-1 text-sm text-warn">{BLOCKER_COPY[a.blocker ?? "error"] ?? a.blocker}</p>
                    {a.error ? <p className="mt-1 text-xs text-muted">{a.error}</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <form action={requeueAttempt.bind(null, a.id)}>
                      <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft">Requeue</button>
                    </form>
                    <form action={skipAttempt.bind(null, a.id)}>
                      <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-accent-soft">Skip</button>
                    </form>
                  </div>
                </div>
                {a.blocker === "unknown_question" && a.questions.length > 0 ? (
                  <form action={answerAndRequeue.bind(null, a.id)} className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                    {a.questions.map((q) => (
                      <label key={q} className="flex flex-col gap-1 text-sm font-medium">
                        {q}
                        <input type="hidden" name="question" value={q} />
                        <textarea name="answer" rows={2} className="rounded-lg border border-line bg-white px-3 py-2 font-normal" />
                      </label>
                    ))}
                    <button type="submit" className="self-start rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90">
                      Save answers and requeue
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="font-display text-xl tracking-tight">Queue and history</h2>
        {rest.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing queued yet. Strong matches at supported companies (Greenhouse, Lever, Ashby boards) appear here automatically; you can also queue any job from its page.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Match</th>
                  <th className="px-3 py-2">Why</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rest.map((a) => (
                  <tr key={a.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/jobs/${a.jobId}`} className="font-medium hover:underline">{a.jobTitle}</Link>
                      <span className="block text-xs text-muted">{a.companyName} · {a.provider}</span>
                    </td>
                    <td className="px-3 py-2">{a.score != null && a.band ? <MatchBadge score={a.score} band={a.band} /> : null}</td>
                    <td className="px-3 py-2 text-muted">{a.reason}</td>
                    <td className="px-3 py-2">
                      <span className={a.status === "SUBMITTED" ? "text-good" : a.status === "FAILED" ? "text-warn" : ""}>{STATUS_LABEL[a.status] ?? a.status}</span>
                      {a.hasScreenshot ? (
                        <a href={`/api/apply/screenshot/${a.id}`} target="_blank" className="ml-2 text-xs text-muted underline">proof</a>
                      ) : null}
                      {a.error && a.status === "FAILED" ? <span className="block max-w-xs truncate text-xs text-muted" title={a.error}>{a.error}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{(a.submittedAt ?? a.updatedAt).toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 py-2">
                      {a.status === "QUEUED" ? (
                        <form action={skipAttempt.bind(null, a.id)}>
                          <button type="submit" className="rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft">Skip</button>
                        </form>
                      ) : a.status === "FAILED" || a.status === "SKIPPED" ? (
                        <form action={requeueAttempt.bind(null, a.id)}>
                          <button type="submit" className="rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft">Requeue</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <form action={updateApplyRules} className="card-surface flex flex-col gap-4 p-4">
          <h2 className="font-semibold">Rules</h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Auto-queue matches at least
            <select name="autoQueueBand" defaultValue={rules.autoQueueBand} className="rounded-lg border border-line bg-white px-3 py-2 font-normal">
              <option value="strong">Strong (75+)</option>
              <option value="good">Good (55+)</option>
              <option value="none">Never auto-queue</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="queueSaved" defaultChecked={rules.queueSaved} className="accent-accent" />
            Also queue anything I save
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Mode
            <select name="mode" defaultValue={rules.mode} className="rounded-lg border border-line bg-white px-3 py-2 font-normal">
              <option value="confirm">Confirm: prefill, then I click Submit</option>
              <option value="handsoff">Hands-off: submit when every field is known</option>
            </select>
          </label>
          <div className="flex gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Applications per day
              <input name="dailyCap" type="number" min={1} max={50} defaultValue={rules.dailyCap} className="w-28 rounded-lg border border-line bg-white px-3 py-2 font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Only jobs newer than (days)
              <input name="maxAgeDays" type="number" min={1} max={60} defaultValue={rules.maxAgeDays} className="w-28 rounded-lg border border-line bg-white px-3 py-2 font-normal" />
            </label>
          </div>
          <button type="submit" className="self-start rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90">Save rules and refresh queue</button>
        </form>

        <div className="card-surface flex flex-col gap-4 p-4">
          <h2 className="font-semibold">Runner on your computer</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>In the project folder: <code className="rounded bg-accent-soft px-1">pnpm install</code> (once).</li>
            <li>Create a device token below and put it in <code className="rounded bg-accent-soft px-1">apps/apply-runner/.env</code> as <code className="rounded bg-accent-soft px-1">SIFARISH_DEVICE_TOKEN</code>, with <code className="rounded bg-accent-soft px-1">SIFARISH_URL={config.APP_URL}</code>.</li>
            <li>Run <code className="rounded bg-accent-soft px-1">pnpm apply</code>. A browser opens; in confirm mode it fills each form and waits for your click.</li>
            <li>Schedule it (Task Scheduler / launchd / cron) if you want it to run at wake-up.</li>
          </ol>
          <form action={createDeviceTokenAction} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Device name
              <input name="name" defaultValue="My laptop" className="rounded-lg border border-line bg-white px-3 py-2 font-normal" />
            </label>
            <button type="submit" className="rounded-lg border border-line px-4 py-2 font-medium hover:bg-accent-soft">Create device token</button>
          </form>
          {tokens.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted">{t.lastUsedAt ? `last used ${t.lastUsedAt.toISOString().slice(0, 16).replace("T", " ")}` : "never used"}</span>
                  <form action={revokeDeviceTokenAction.bind(null, t.id)} className="ml-auto">
                    <button type="submit" className="rounded border border-line px-2 py-1 text-xs text-warn hover:bg-accent-soft">Revoke</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    </div>
  );
}
