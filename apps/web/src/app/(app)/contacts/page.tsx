import Link from "next/link";
import { getDb, contactsRepo } from "@jobos/db";
import { requireUser } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";
import { addContact, importContacts } from "./actions";
import { StatusBadge } from "@/components/status-badge";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { userId } = await requireUser();
  const rows = await contactsRepo.listContacts(getDb(), userId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Contacts</h1>
        <p className="mt-1 text-sm text-muted">
          Recruiters and hiring managers you can reach out to. Add people you find yourself — JobOS
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

      {rows.length === 0 ? (
        <EmptyState
          title="No contacts yet"
          body="Add a recruiter or hiring manager above. If their company is one JobOS tracks, email suggestions get sharper with every verified address."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
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
      )}
    </div>
  );
}
