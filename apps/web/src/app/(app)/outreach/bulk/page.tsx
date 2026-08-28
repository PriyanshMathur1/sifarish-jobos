import Link from "next/link";
import { z } from "zod";
import { desc, eq, and, isNull, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@sifarish/db";
import { prepareOutreach } from "@sifarish/core";
import { requireUser } from "@/lib/session";
import { bulkApproveAction } from "../actions";

export const metadata = { title: "Bulk outreach" };
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const MAX_BATCH = 25;

function asList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function BulkOutreachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const db = getDb();

  const allIds = asList(sp.c).filter((id) => uuid.safeParse(id).success);
  const truncated = allIds.length > MAX_BATCH;
  const contactIds = [...new Set(allIds)].slice(0, MAX_BATCH);
  const templateId = uuid.safeParse(sp.template).success ? (sp.template as string) : undefined;
  const jobId = uuid.safeParse(sp.job).success ? (sp.job as string) : undefined;

  if (contactIds.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link href="/contacts" className="text-sm text-muted hover:underline">
          ← Contacts
        </Link>
        <p className="mt-4 rounded-lg border border-warn/40 bg-white px-4 py-3 text-sm text-warn">
          No contacts selected. Go back to Contacts, tick the ones with a known email, and click
          &ldquo;Reach out to selected&rdquo;.
        </p>
      </div>
    );
  }

  const [contacts, jobRows, templateRows] = await Promise.all([
    db
      .select({
        id: schema.contacts.id,
        name: schema.contacts.fullName,
        email: schema.contacts.businessEmail,
        company: schema.companies.name,
      })
      .from(schema.contacts)
      .leftJoin(schema.companies, eq(schema.contacts.companyId, schema.companies.id))
      .where(
        and(
          eq(schema.contacts.userId, userId),
          isNull(schema.contacts.suppressedAt),
          inArray(schema.contacts.id, contactIds),
        ),
      ),
    db
      .select({ id: schema.jobs.id, title: schema.jobs.title, company: schema.companies.name })
      .from(schema.jobs)
      .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
      .where(inArray(schema.jobs.status, ["ACTIVE", "UNKNOWN"]))
      .orderBy(desc(schema.jobs.firstSeenAt))
      .limit(100),
    db
      .select()
      .from(schema.templates)
      .where(sql`(${schema.templates.userId} = ${userId} or ${schema.templates.isBuiltin} = true)`)
      .orderBy(desc(schema.templates.isBuiltin)),
  ]);

  // Step 1: no template chosen yet — show who's selected + pick template/job.
  if (!templateId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link href="/contacts" className="text-sm text-muted hover:underline">
          ← Contacts
        </Link>
        <h1 className="font-display mt-2 text-2xl tracking-tight">
          Bulk outreach: {contacts.length} selected
        </h1>
        {truncated ? (
          <p className="mt-1 text-sm text-warn">
            Only the first {MAX_BATCH} selected contacts are included in one batch.
          </p>
        ) : null}
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {contacts.map((c) => (
            <li key={c.id} className="rounded-full border border-line bg-white px-3 py-1">
              {c.name}
              {c.company ? ` · ${c.company}` : ""}
            </li>
          ))}
        </ul>

        <form method="GET" className="mt-6 flex flex-col gap-3 rounded-xl border border-line bg-white p-4">
          {contactIds.map((id) => (
            <input key={id} type="hidden" name="c" value={id} />
          ))}
          <label className="flex flex-col gap-1 text-sm font-medium">
            Template *
            <select
              name="template"
              required
              className="rounded-lg border border-line px-3 py-2 font-normal"
            >
              <option value="">Choose a template…</option>
              {templateRows.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isBuiltin ? " (built-in)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Job (fills {"{{job_title}}"} and {"{{relevant_skill}}"} for everyone)
            <select name="job" className="rounded-lg border border-line px-3 py-2 font-normal">
              <option value="">No specific job</option>
              {jobRows.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} — {j.company}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            One template, but every recipient gets their own name and company filled in. You&rsquo;ll
            see each rendered message before anything is created.
          </p>
          <button
            type="submit"
            className="self-start rounded-lg border border-line px-4 py-2 font-medium hover:bg-accent-soft"
          >
            Preview all
          </button>
        </form>
      </div>
    );
  }

  // Step 2: render a preview per contact, split into ready vs skipped.
  const previews = await Promise.all(
    contactIds.map(async (id) => {
      const contact = contacts.find((c) => c.id === id);
      const result = await prepareOutreach(db, userId, {
        contactId: id,
        ...(jobId ? { jobId } : {}),
        templateId,
      });
      return { id, name: contact?.name ?? "?", result };
    }),
  );
  const ready = previews.filter((p) => p.result.ok) as Array<{
    id: string;
    name: string;
    result: Extract<(typeof previews)[number]["result"], { ok: true }>;
  }>;
  const skipped = previews.filter((p) => !p.result.ok);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/contacts" className="text-sm text-muted hover:underline">
        ← Contacts
      </Link>
      <h1 className="font-display mt-2 text-2xl tracking-tight">
        Review: {ready.length} ready, {skipped.length} skipped
      </h1>

      {skipped.length > 0 ? (
        <div className="mt-4 rounded-xl border border-warn/40 bg-white p-4 text-sm">
          <h2 className="font-semibold text-warn">Skipped</h2>
          <ul className="mt-2 flex flex-col gap-1 text-muted">
            {skipped.map((p) => (
              <li key={p.id}>
                {p.name} —{" "}
                {!p.result.ok && p.result.error.kind === "no_email"
                  ? "no email yet"
                  : !p.result.ok && p.result.error.kind === "suppressed"
                    ? "suppressed"
                    : !p.result.ok && p.result.error.kind === "missing_vars"
                      ? `needs ${p.result.error.missing.map((v) => `{{${v}}}`).join(", ")} — edit individually instead`
                      : "couldn't be prepared"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ready.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing left to draft in this batch.</p>
      ) : (
        <form action={bulkApproveAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="templateId" value={templateId} />
          <input type="hidden" name="jobId" value={jobId ?? ""} />
          {ready.map((p) => (
            <div key={p.id} className="rounded-xl border border-line bg-white p-4 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="c"
                  value={p.id}
                  defaultChecked
                  className="mt-1"
                  aria-label={`Include ${p.name}`}
                />
                <span className="flex-1">
                  <span className="font-medium">{p.name}</span>{" "}
                  <span className="text-muted">&lt;{p.result.value.toEmail}&gt;</span>
                  <br />
                  <span className="text-muted">Subject:</span> {p.result.value.subject}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">Preview body</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">
                      {p.result.value.body}
                    </pre>
                  </details>
                </span>
                <Link
                  href={`/outreach/new?contact=${p.id}&template=${templateId}${jobId ? `&job=${jobId}` : ""}`}
                  className="text-xs text-muted underline"
                >
                  edit individually
                </Link>
              </label>
            </div>
          ))}
          <button
            type="submit"
            className="self-start rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
          >
            Create {ready.length} Gmail draft{ready.length === 1 ? "" : "s"}
          </button>
          <p className="text-xs text-muted">
            Every draft lands in your Gmail Drafts, unsent — this only saves you the one-by-one
            clicking. Anyone you&rsquo;ve already messaged in the last 14 days is skipped
            automatically; you still send each one yourself from Gmail.
          </p>
        </form>
      )}
    </div>
  );
}
