import Link from "next/link";
import { z } from "zod";
import { desc, eq, and, isNull, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@sifarish/db";
import { prepareOutreach } from "@sifarish/core";
import { requireUser } from "@/lib/session";
import { approveAction } from "../actions";

export const metadata = { title: "New outreach" };
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();

export default async function NewOutreachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const db = getDb();

  const contactId = uuid.safeParse(sp.contact).success ? (sp.contact as string) : undefined;
  const jobId = uuid.safeParse(sp.job).success ? (sp.job as string) : undefined;
  const templateId = uuid.safeParse(sp.template).success ? (sp.template as string) : undefined;

  // Override inputs arrive as ov_<var> params.
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k.startsWith("ov_") && typeof v === "string" && v) overrides[k.slice(3)] = v.slice(0, 300);
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
      .where(and(eq(schema.contacts.userId, userId), isNull(schema.contacts.suppressedAt)))
      .orderBy(desc(schema.contacts.createdAt))
      .limit(100),
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

  const ready = contactId && templateId;
  const prep = ready
    ? await prepareOutreach(db, userId, {
        contactId: contactId,
        ...(jobId ? { jobId } : {}),
        templateId: templateId,
        overrides,
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/outreach" className="text-sm text-muted hover:underline">
        ← Outreach
      </Link>
      <h1 className="font-display mt-2 text-2xl tracking-tight">New outreach</h1>

      <form
        method="GET"
        className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Contact *
          <select
            name="contact"
            defaultValue={contactId ?? ""}
            required
            className="rounded-lg border border-line px-3 py-2 font-normal"
          >
            <option value="">Choose a contact…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.email}>
                {c.name}
                {c.company ? ` — ${c.company}` : ""}
                {c.email ? "" : " (no email yet)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Job (fills {"{{job_title}}"} and {"{{relevant_skill}}"})
          <select
            name="job"
            defaultValue={jobId ?? ""}
            className="rounded-lg border border-line px-3 py-2 font-normal"
          >
            <option value="">No specific job</option>
            {jobRows.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} — {j.company}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Template *
          <select
            name="template"
            defaultValue={templateId ?? ""}
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
        {prep && !prep.ok && prep.error.kind === "missing_vars"
          ? prep.error.missing.map((v) => (
              <label key={v} className="flex flex-col gap-1 text-sm font-medium text-warn">
                {`{{${v}}}`} couldn't be resolved — fill it in:
                <input
                  name={`ov_${v}`}
                  defaultValue={overrides[v] ?? ""}
                  className="rounded-lg border border-warn/40 px-3 py-2 font-normal text-ink"
                />
              </label>
            ))
          : null}
        <button
          type="submit"
          className="self-start rounded-lg border border-line px-4 py-2 font-medium hover:bg-accent-soft"
        >
          Preview
        </button>
      </form>

      {prep && !prep.ok && prep.error.kind !== "missing_vars" ? (
        <p className="mt-4 rounded-lg border border-warn/40 bg-white px-4 py-3 text-sm text-warn">
          {prep.error.kind === "no_email"
            ? "This contact has no email yet — open their page and pick a suggested address first."
            : prep.error.kind === "suppressed"
              ? "This contact is suppressed."
              : "Something needed for this preview was not found."}
        </p>
      ) : null}

      {prep?.ok ? (
        <form
          action={approveAction}
          className="mt-6 flex flex-col gap-3 rounded-xl border border-accent/40 bg-white p-4"
        >
          <h2 className="font-semibold">Preview — every word is yours to edit</h2>
          <p className="text-sm text-muted">
            To: <span className="font-mono">{prep.value.toEmail}</span>
          </p>
          <input type="hidden" name="contactId" value={prep.value.contactId} />
          <input type="hidden" name="jobId" value={prep.value.jobId ?? ""} />
          <input type="hidden" name="templateId" value={prep.value.templateId} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            Subject
            <input
              name="subject"
              defaultValue={prep.value.subject}
              className="rounded-lg border border-line px-3 py-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Body
            <textarea
              name="body"
              rows={12}
              defaultValue={prep.value.body}
              className="rounded-lg border border-line px-3 py-2 font-normal"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              name="mode"
              value="draft"
              className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
            >
              Create Gmail draft
            </button>
            {process.env.OUTREACH_DIRECT_SEND === "true" ? (
              <button
                type="submit"
                name="mode"
                value="send"
                className="rounded-lg border border-warn px-4 py-2 font-medium text-warn hover:bg-warn hover:text-paper"
              >
                Send now
              </button>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            Draft mode puts the email in your Gmail Drafts — you send it from Gmail. One recipient
            per message, one message per person per two weeks.
          </p>
        </form>
      ) : null}
    </div>
  );
}
