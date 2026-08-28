import { getDb, profilesRepo } from "@sifarish/db";
import { requireUser } from "@/lib/session";
import { getGmailStatus } from "@/lib/gmail";
import { updateProfile, deleteAccount, disconnectGmail } from "./actions";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { userId } = await requireUser();
  const profile = await profilesRepo.getProfile(getDb(), userId);
  const gmail = await getGmailStatus(userId);

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-[28px] tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted">
        Powers search defaults and outreach template variables like{" "}
        <code className="rounded bg-accent-soft px-1">{"{{current_title}}"}</code> and{" "}
        <code className="rounded bg-accent-soft px-1">{"{{relevant_skill}}"}</code>.
      </p>

      <form action={updateProfile} className="mt-6 flex flex-col gap-4">
        <Field label="Full name" name="fullName" defaultValue={profile?.fullName ?? ""} />
        <Field
          label="Current / most recent title"
          name="currentTitle"
          defaultValue={profile?.currentTitle ?? ""}
        />
        <Field
          label="Years of experience"
          name="yearsExperience"
          type="number"
          defaultValue={profile?.yearsExperience?.toString() ?? ""}
        />
        <Field
          label="Skills (comma-separated, strongest first)"
          name="skills"
          defaultValue={(profile?.skills ?? []).join(", ")}
        />
        <Field
          label="Locations (comma-separated)"
          name="locations"
          defaultValue={(profile?.locations ?? []).join(", ")}
        />
        <button
          type="submit"
          className="self-start rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
        >
          Save profile
        </button>
      </form>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-semibold">Gmail</h2>
        {gmail.connected ? (
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span>
              Connected as <span className="font-mono">{gmail.email}</span> — outreach drafts land
              in this mailbox.
            </span>
            <form action={disconnectGmail}>
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 hover:bg-accent-soft"
              >
                Disconnect
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-2 text-sm text-muted">
            <p>
              Connect Gmail so approved outreach becomes a draft in your own mailbox (scope: compose
              only — Sifarish cannot read your email).
            </p>
            <a
              href="/api/gmail/connect"
              className="mt-2 inline-block rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
            >
              Connect Gmail
            </a>
          </div>
        )}
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-sm font-semibold text-warn">Danger zone</h2>
        <p className="mt-1 text-sm text-muted">
          Deleting your account removes your profile, preferences, contacts, outreach history, and
          applications permanently.
        </p>
        <form action={deleteAccount} className="mt-3">
          <button
            type="submit"
            className="rounded-lg border border-warn px-4 py-2 text-sm font-medium text-warn hover:bg-warn hover:text-paper"
          >
            Delete account and all data
          </button>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="rounded-lg border border-line bg-white px-3 py-2 font-normal"
      />
    </label>
  );
}
