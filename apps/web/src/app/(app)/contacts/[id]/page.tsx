import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb, contactsRepo } from "@sifarish/db";
import { EmailValidator, inferEmails, loadConfig } from "@sifarish/core";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/components/status-badge";
import { chooseSuggestedEmail, suppressContactAction, lookupEmailViaHunter, editContact } from "../actions";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const db = getDb();
  const row = await contactsRepo.getContact(db, userId, id);
  if (!row) notFound();
  const { contact, companyName, companyDomain } = row;

  // Email suggestions (PRD §70): learned company patterns + generic library,
  // validated (syntax+MX where the network allows) with honest labels.
  let suggestions: Array<{ email: string; status: string; basis: string }> = [];
  if (!contact.businessEmail && companyDomain) {
    const patterns = contact.companyId
      ? await contactsRepo.getCompanyPatterns(db, contact.companyId)
      : [];
    const candidates = inferEmails(contact.fullName, {
      domain: companyDomain,
      learnedPatterns: patterns.map((p) => ({
        pattern: p.pattern,
        confidence: p.confidence,
        evidenceCount: p.evidenceCount,
      })),
    }).slice(0, 5);
    const validator = new EmailValidator();
    suggestions = await Promise.all(
      candidates.map(async (c) => {
        const v = await validator.validate(c.email, {
          origin: c.basis === "company_pattern" ? "company_pattern" : "generated",
          evidenceCount: patterns.find((p) => p.pattern === c.pattern)?.evidenceCount ?? 0,
        });
        return { email: c.email, status: v.status, basis: c.basis };
      }),
    );
    suggestions = suggestions.filter((s) => s.status !== "INVALID");
  }

  const hunterAvailable =
    !contact.businessEmail && !!companyDomain && !!loadConfig().HUNTER_API_KEY;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/contacts" className="text-sm text-muted hover:underline">
        ← Contacts
      </Link>
      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="font-display text-[28px] tracking-tight">{contact.fullName}</h1>
          <p className="mt-1 text-muted">
            {[contact.title, companyName].filter(Boolean).join(" · ") || "No title/company"}
          </p>
        </div>
        <form action={suppressContactAction.bind(null, contact.id)}>
          <button
            type="submit"
            className="rounded-lg border border-warn px-3 py-1.5 text-sm text-warn hover:bg-warn hover:text-paper"
          >
            Suppress
          </button>
        </form>
      </div>

      <section className="mt-6 rounded-xl border border-line bg-white p-4">
        <h2 className="font-semibold">Email</h2>
        {contact.businessEmail ? (
          <p className="mt-2 flex items-center gap-2">
            <span className="font-mono">{contact.businessEmail}</span>
            <StatusBadge status={contact.emailStatus} />
          </p>
        ) : suggestions.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-muted">
              Suggested addresses — pattern-inferred, never guaranteed. Pick one to use it:
            </p>
            {suggestions.map((s) => (
              <form
                key={s.email}
                action={chooseSuggestedEmail.bind(null, contact.id, s.email, s.status)}
                className="flex items-center gap-2"
              >
                <span className="font-mono text-sm">{s.email}</span>
                <StatusBadge status={s.status} />
                {s.basis === "company_pattern" ? (
                  <span className="text-xs text-muted">(company pattern)</span>
                ) : null}
                <button
                  type="submit"
                  className="ml-auto rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                >
                  Use this
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">
            No reliable professional contact email found yet. You can still apply directly, or add
            the email if you find it.
          </p>
        )}
        {hunterAvailable ? (
          <form action={lookupEmailViaHunter.bind(null, contact.id)} className="mt-3">
            <button
              type="submit"
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
            >
              Look up via Hunter.io
            </button>
            <span className="ml-2 text-xs text-muted">
              uses 1 of your free monthly credits · still not guaranteed
            </span>
          </form>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-line bg-white p-4 text-sm">
        <h2 className="font-semibold">Provenance</h2>
        <p className="mt-1 text-muted">
          Source:{" "}
          {contact.sourceType === "manual" ? "added by you" : "discovered from a public page"}
          {contact.sourceUrl ? (
            <>
              {" · "}
              <a
                className="underline"
                href={contact.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {contact.sourceUrl}
              </a>
            </>
          ) : null}
          {" · "}added {contact.createdAt.toISOString().slice(0, 10)}
        </p>
      </section>

      <details className="mt-4 rounded-xl border border-line bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Edit details</summary>
        <form action={editContact.bind(null, contact.id)} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-medium">
            Full name
            <input name="fullName" required defaultValue={contact.fullName} className="rounded-lg border border-line px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Title
            <input name="title" defaultValue={contact.title ?? ""} className="rounded-lg border border-line px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Company (must match a tracked company to enable email suggestions)
            <input name="companyName" defaultValue={companyName ?? ""} className="rounded-lg border border-line px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Email
            <input name="email" type="email" defaultValue={contact.businessEmail ?? ""} className="rounded-lg border border-line px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 font-medium sm:col-span-2">
            Profile URL
            <input name="url" defaultValue={contact.professionalUrls[0] ?? ""} className="rounded-lg border border-line px-3 py-2 font-normal" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90">Save changes</button>
          </div>
        </form>
      </details>

      <div className="mt-6">
        <Link
          href={`/outreach/new?contact=${contact.id}`}
          className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
        >
          Compose outreach →
        </Link>
      </div>
    </div>
  );
}
