import { auth } from "@/auth";
import { getDb, schema } from "@jobos/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { updateProfile } from "./actions";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const db = getDb();
  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, session.user.id));

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold">Profile</h1>
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
