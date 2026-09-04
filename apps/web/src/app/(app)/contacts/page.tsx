import Link from "next/link";
import { getDb, contactsRepo } from "@sifarish/db";
import { requireUser } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { addContact, importContacts, discoverFromPage, importLinkedInCsv } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { SelectAllCheckbox } from "@/components/select-all-checkbox";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { userId } = await requireUser();
  const rows = await contactsRepo.listContacts(getDb(), userId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[28px] tracking-tight">Contacts</h1>
        <p className="mt-1 text-sm text-muted">
          Recruiters and hiring managers you can reach out to. Add people you find yourself — Sifarish
          suggests probable work emails with honest confidence labels.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <form
          action={addContact}
          className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4"
        >
          <h2 className="font-semibold">Add a contact</h2>
          <input
            name="fullName"
            required
            placeholder="Full name *"
            className="rounded-lg border border-line px-3 py-2"
          />
          <input
            name="title"
            placeholder="Title (e.g. Talent Partner)"
            className="rounded-lg border border-line px-3 py-2"
          />
          <input
            name="companyName"
            placeholder="Company (match a tracked company for email patterns)"
            className="rounded-lg border border-line px-3 py-2"
          />
          <input
            name="email"
            type="email"
            placeholder="Email (if you know it)"
            className="rounded-lg border border-line px-3 py-2"
          />
          <input
            name="url"
            type="url"
            placeholder="Public profile URL (provenance)"
            className="rounded-lg border border-line px-3 py-2"
          />
          <button
            type="submit"
            className="self-start rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
          >
            Add contact
          </button>
        </form>

        <form
          action={importContacts}
          className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4"
        >
          <h2 className="font-semibold">Paste import</h2>
          <p className="text-xs text-muted">
            One per line: Name, Title, Company, email (last two optional)
          </p>
          <textarea
            name="bulk"
            rows={6}
            placeholder={
              "Anita Desai, Talent Partner, Razorpay\nRahul Verma, Product Director, Fam (FamPay), rahul@famapp.in"
            }
            className="rounded-lg border border-line px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            className="self-start rounded-lg border border-line px-4 py-2 font-medium hover:bg-accent-soft"
          >
            Import
          </button>
        </form>
      </section>

      <form
        action={importLinkedInCsv}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4"
      >
        <div className="flex-1">
          <h2 className="font-semibold">Import your LinkedIn connections</h2>
          <p className="text-xs text-muted">
            Your own data export: LinkedIn → Settings → Data privacy → Get a copy of your data →
            Connections. Upload the Connections.csv. Names, titles and companies come through;
            emails only where the connection allowed it.
          </p>
        </div>
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="onlyTracked" defaultChecked className="accent-accent" />
          Only people at companies Sifarish tracks
        </label>
        <button
          type="submit"
          className="rounded-lg border border-line px-4 py-2 font-medium hover:bg-accent-soft"
        >
          Import CSV
        </button>
      </form>

      {process.env.CONTACT_DISCOVERY === "true" ? (
        <form
          action={discoverFromPage}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-4"
        >
          <div className="flex-1">
            <h2 className="font-semibold">Discover from a public page</h2>
            <p className="text-xs text-muted">
              Company team/about pages with schema.org Person data only — conservative by design.
            </p>
          </div>
          <input
            name="url"
            type="url"
            required
            placeholder="https://company.example/team"
            className="min-w-64 rounded-lg border border-line px-3 py-2"
          />
          <input
            name="companyName"
            placeholder="Company (optional)"
            className="rounded-lg border border-line px-3 py-2"
          />
          <button
            type="submit"
            className="rounded-lg border border-line px-4 py-2 font-medium hover:bg-accent-soft"
          >
            Discover
          </button>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No contacts yet"
          body="Add a recruiter or hiring manager above. If their company is one Sifarish tracks, email suggestions get sharper with every verified address."
        />
      ) : (
        <form method="GET" action="/outreach/bulk">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-muted">
              Select contacts with a known email. Draft in Gmail puts one templated message per
              person in your Drafts; Start campaign sends them from your Gmail a few at a time
              with follow-ups.
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-accent-soft"
              >
                Draft in Gmail
              </button>
              <button
                type="submit"
                formAction="/outreach/campaigns/new"
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90"
              >
                Start campaign
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-3 py-2">
                    <SelectAllCheckbox name="c" />
                  </th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">
                      {c.businessEmail ? (
                        <input type="checkbox" name="c" value={c.id} aria-label={`Select ${c.fullName}`} />
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/contacts/${c.id}`} className="hover:underline">
                        {c.fullName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{c.title ?? "—"}</td>
                    <td className="px-3 py-2">{c.companyName ?? "—"}</td>
                    <td className="px-3 py-2">
                      {c.businessEmail ?? <span className="text-muted">none yet</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.emailStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </div>
  );
}
