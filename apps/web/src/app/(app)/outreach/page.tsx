import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@sifarish/db";
import { requireUser } from "@/lib/session";
import { getGmailStatus } from "@/lib/gmail";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Outreach" };
export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  gmail_not_connected:
    "Connect Gmail on your Profile page first — drafts are created in your own mailbox.",
  duplicate_recipient:
    "You already reached out to this address recently. One message per person per two weeks.",
  send_disabled: "Direct send is off (OUTREACH_DIRECT_SEND). The draft path still works.",
  cap_reached:
    "Daily send cap reached — protects your address from spam flags. Try tomorrow or use drafts.",
  suppressed: "This address is suppressed and cannot be contacted.",
  gmail_failed:
    "Gmail call failed — your message text is saved with status FAILED, nothing was lost.",
  rate_limited: "Too many approvals in a short burst — wait a minute and continue.",
};

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const gmail = await getGmailStatus(userId);

  const messages = await db
    .select({
      id: schema.outreachMessages.id,
      toEmail: schema.outreachMessages.toEmail,
      subject: schema.outreachMessages.subject,
      status: schema.outreachMessages.status,
      mode: schema.outreachMessages.mode,
      createdAt: schema.outreachMessages.createdAt,
      contactName: schema.contacts.fullName,
    })
    .from(schema.outreachMessages)
    .innerJoin(schema.contacts, eq(schema.outreachMessages.contactId, schema.contacts.id))
    .where(eq(schema.outreachMessages.userId, userId))
    .orderBy(desc(schema.outreachMessages.createdAt))
    .limit(50);

  const error = typeof sp.error === "string" ? ERROR_COPY[sp.error] : null;
  const done = typeof sp.done === "string" ? sp.done : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Outreach</h1>
          <p className="mt-1 text-sm text-muted">
            Every message is prepared, previewed, and approved by you — one at a time, no blasts.
          </p>
        </div>
        <Link
          href="/outreach/new"
          className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
        >
          New outreach
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg border border-warn/40 bg-white px-4 py-3 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {done === "drafted" ? (
        <p className="rounded-lg border border-good/40 bg-white px-4 py-3 text-sm text-good">
          Draft created in your Gmail — open Gmail, give it a final read, and hit send.
        </p>
      ) : null}
      {done === "sent" ? (
        <p className="rounded-lg border border-good/40 bg-white px-4 py-3 text-sm text-good">
          Sent.
        </p>
      ) : null}
      {!gmail.connected ? (
        <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">
          Gmail isn't connected yet —{" "}
          <Link href="/profile" className="underline">
            connect it on your Profile
          </Link>{" "}
          to create drafts. Everything else here works meanwhile.
        </p>
      ) : null}

      {messages.length === 0 ? (
        <EmptyState
          title="No outreach yet"
          body="Pick a job, pick a contact, pick a template — Sifarish fills the variables, you edit and approve. The message lands in your Gmail drafts."
          action={
            <Link
              href="/outreach/new"
              className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
            >
              Compose your first outreach
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{m.contactName}</span>{" "}
                    <span className="text-muted">&lt;{m.toEmail}&gt;</span>
                  </td>
                  <td className="max-w-72 truncate px-3 py-2">{m.subject}</td>
                  <td className="px-3 py-2 text-muted">{m.mode}</td>
                  <td className="px-3 py-2">{m.status}</td>
                  <td className="px-3 py-2 text-muted">
                    {m.createdAt.toISOString().slice(0, 16).replace("T", " ")}
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
