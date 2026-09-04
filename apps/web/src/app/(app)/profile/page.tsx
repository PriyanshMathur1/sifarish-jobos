import { getDb, profilesRepo } from "@sifarish/db";
import { requireUser } from "@/lib/session";
import { getGmailStatus } from "@/lib/gmail";
import {
  updateProfile,
  updateApplicationDetails,
  updatePreferences,
  uploadResume,
  setDefaultResume,
  deleteResume,
  saveAnswer,
  deleteAnswer,
  deleteAccount,
  disconnectGmail,
  updateAlertPreferences,
  detectTelegramChat,
  sendTestDigest,
} from "./actions";
import { loadConfig } from "@sifarish/core";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const STARTER_QUESTIONS = [
  "Why do you want to work here?",
  "What is your notice period?",
  "Are you legally authorised to work in India?",
  "Have you previously applied to or worked at this company?",
  "Where did you hear about this role?",
];

export default async function ProfilePage() {
  const { userId } = await requireUser();
  const db = getDb();
  const [profile, prefs, resumes, answers, gmail, alertPrefs] = await Promise.all([
    profilesRepo.getProfile(db, userId),
    profilesRepo.getPreferences(db, userId),
    profilesRepo.listResumes(db, userId),
    profilesRepo.listAnswers(db, userId),
    getGmailStatus(userId),
    profilesRepo.getAlertPreferences(db, userId),
  ]);
  const config = loadConfig();
  const channels = { email: Boolean(config.SMTP_URL), telegram: Boolean(config.TELEGRAM_BOT_TOKEN) };

  const answeredKeys = new Set(answers.map((a) => a.questionKey));
  const starters = STARTER_QUESTIONS.filter((q) => !answeredKeys.has(profilesRepo.questionKey(q)));

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-[28px] tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted">
        One place for everything the feed scores against and every form field the apply runner
        fills in. Template variables like{" "}
        <code className="rounded bg-accent-soft px-1">{"{{current_title}}"}</code> read from here
        too.
      </p>

      <Section title="Basics" body="Drives matching (title, seniority from years, skills in order of strength).">
        <form action={updateProfile} className="flex flex-col gap-4">
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
            label="Preferred cities (comma-separated)"
            name="locations"
            defaultValue={(profile?.locations ?? []).join(", ")}
          />
          <SaveButton>Save basics</SaveButton>
        </form>
      </Section>

      <Section
        title="Matching preferences"
        body="What the feed ranks for. Leave target roles empty to use your current title."
      >
        <form action={updatePreferences} className="flex flex-col gap-4">
          <Field
            label="Target roles (comma-separated titles)"
            name="targetRoles"
            defaultValue={(prefs?.targetRoles ?? []).join(", ")}
            placeholder="Product Manager, Growth Product Manager"
          />
          <Field
            label="Target functions"
            name="targetFunctions"
            defaultValue={(prefs?.targetFunctions ?? []).join(", ")}
            placeholder="Product"
          />
          <Field
            label="Preferred cities for matching (overrides basics when set)"
            name="locations"
            defaultValue={(prefs?.locations ?? []).join(", ")}
          />
          <label className="flex flex-col gap-1 text-sm font-medium">
            Remote preference
            <select
              name="remotePref"
              defaultValue={prefs?.remotePref ?? "any"}
              className="rounded-lg border border-line bg-white px-3 py-2 font-normal"
            >
              <option value="any">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="office">Office</option>
            </select>
          </label>
          <div className="flex flex-col gap-2 text-sm">
            <Check
              name="remoteRequired"
              label="Remote is required (non-remote roles are dropped, not just ranked lower)"
              defaultChecked={prefs?.strictness?.remote === "required"}
            />
            <Check
              name="locationsRequired"
              label="Preferred cities are required (other cities dropped unless the role is remote)"
              defaultChecked={prefs?.strictness?.locations === "required"}
            />
          </div>
          <Field
            label="Never show these companies (comma-separated)"
            name="excludedCompanies"
            defaultValue={(prefs?.excludedCompanies ?? []).join(", ")}
          />
          <Field
            label="Never show these industries (comma-separated)"
            name="industriesExcluded"
            defaultValue={(prefs?.industriesExcluded ?? []).join(", ")}
          />
          <SaveButton>Save preferences and re-score</SaveButton>
        </form>
      </Section>

      <Section
        title="Application details"
        body="Filled straight into hosted application forms by the apply runner."
      >
        <form action={updateApplicationDetails} className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" name="phone" defaultValue={profile?.phone ?? ""} placeholder="+91 " />
          <Field
            label="Current location"
            name="currentLocation"
            defaultValue={profile?.currentLocation ?? ""}
          />
          <Field label="LinkedIn URL" name="linkedinUrl" defaultValue={profile?.linkedinUrl ?? ""} />
          <Field
            label="Portfolio / website URL"
            name="portfolioUrl"
            defaultValue={profile?.portfolioUrl ?? ""}
          />
          <Field
            label="Notice period (days)"
            name="noticePeriodDays"
            type="number"
            defaultValue={profile?.noticePeriodDays?.toString() ?? ""}
          />
          <Field
            label="Work authorisation"
            name="workAuthorization"
            defaultValue={profile?.workAuthorization ?? ""}
            placeholder="Indian citizen"
          />
          <Field
            label="Current CTC (LPA)"
            name="currentCtcLpa"
            type="number"
            defaultValue={profile?.currentCtcLpa?.toString() ?? ""}
          />
          <Field
            label="Expected CTC (LPA)"
            name="expectedCtcLpa"
            type="number"
            defaultValue={profile?.expectedCtcLpa?.toString() ?? ""}
          />
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Willing to relocate
            <select
              name="willingToRelocate"
              defaultValue={
                profile?.willingToRelocate == null ? "" : profile.willingToRelocate ? "yes" : "no"
              }
              className="rounded-lg border border-line bg-white px-3 py-2 font-normal"
            >
              <option value="">Not set</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <SaveButton>Save application details</SaveButton>
          </div>
        </form>
      </Section>

      <Section title="Resumes" body="PDF only, 5 MB max. The default is what gets attached unless a job picks another.">
        {resumes.length > 0 ? (
          <ul className="mb-4 flex flex-col gap-2">
            {resumes.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 text-sm"
              >
                <a href={`/api/resumes/${r.id}`} target="_blank" className="font-medium hover:underline">
                  {r.label}
                </a>
                <span className="text-muted">
                  {r.fileName} · {Math.round(r.bytes / 1024)} KB
                </span>
                {r.isDefault ? (
                  <span className="rounded bg-accent-soft px-2 py-0.5 text-xs text-accent">Default</span>
                ) : (
                  <form action={setDefaultResume.bind(null, r.id)}>
                    <button type="submit" className="rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft">
                      Make default
                    </button>
                  </form>
                )}
                <form action={deleteResume.bind(null, r.id)} className="ml-auto">
                  <button type="submit" className="rounded border border-line px-2 py-1 text-xs text-warn hover:bg-accent-soft">
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-muted">No resume uploaded yet. The apply runner cannot submit without one.</p>
        )}
        <form action={uploadResume} className="flex flex-wrap items-end gap-3">
          <Field label="Label" name="label" defaultValue="" placeholder="Default, or Fintech PM" />
          <label className="flex flex-col gap-1 text-sm font-medium">
            PDF file
            <input
              name="file"
              type="file"
              accept="application/pdf"
              required
              className="rounded-lg border border-line bg-white px-3 py-1.5 font-normal"
            />
          </label>
          <SaveButton>Upload</SaveButton>
        </form>
      </Section>

      <Section
        title="Answer bank"
        body="Saved answers to questions application forms ask. The runner matches on the question text; anything it cannot answer pauses and asks you here."
      >
        {answers.length > 0 ? (
          <ul className="mb-4 flex flex-col gap-2">
            {answers.map((a) => (
              <li key={a.id} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.questionText}</p>
                    <p className="mt-1 whitespace-pre-wrap text-muted">{a.answer}</p>
                  </div>
                  <form action={deleteAnswer.bind(null, a.id)}>
                    <button type="submit" className="rounded border border-line px-2 py-1 text-xs text-warn hover:bg-accent-soft">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {starters.length > 0 ? (
          <p className="mb-3 text-xs text-muted">
            Common questions still unanswered: {starters.join(" · ")}
          </p>
        ) : null}
        <form action={saveAnswer} className="flex flex-col gap-3">
          <Field
            label="Question (as the form words it)"
            name="question"
            defaultValue=""
            placeholder={starters[0] ?? "Why do you want to work here?"}
          />
          <label className="flex flex-col gap-1 text-sm font-medium">
            Answer
            <textarea
              name="answer"
              rows={3}
              required
              className="rounded-lg border border-line bg-white px-3 py-2 font-normal"
            />
          </label>
          <SaveButton>Save answer</SaveButton>
        </form>
      </Section>

      <Section
        title="Alerts"
        body="Instant pings when a new opening clears the bar, plus one digest a day. Channels available depend on what the server has configured."
      >
        <form action={updateAlertPreferences} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Channel
            <select
              name="channel"
              defaultValue={alertPrefs?.channel ?? "email"}
              className="rounded-lg border border-line bg-white px-3 py-2 font-normal"
            >
              <option value="email">Email{channels.email ? "" : " (SMTP not configured)"}</option>
              <option value="telegram">Telegram{channels.telegram ? "" : " (bot token not configured)"}</option>
              <option value="none">Off</option>
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3 text-sm">
              <Check name="instantEnabled" label="Instant alerts" defaultChecked={alertPrefs?.instantEnabled ?? true} />
              <BandSelect name="instantMinBand" label="for matches at least" defaultValue={alertPrefs?.instantMinBand ?? "strong"} />
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3 text-sm">
              <Check name="digestEnabled" label="Daily digest" defaultChecked={alertPrefs?.digestEnabled ?? true} />
              <BandSelect name="digestMinBand" label="for matches at least" defaultValue={alertPrefs?.digestMinBand ?? "good"} />
              <label className="flex items-center gap-2">
                at
                <input
                  name="digestHour"
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={alertPrefs?.digestHour ?? 9}
                  className="w-16 rounded-lg border border-line bg-white px-2 py-1 font-normal"
                />
                :00 IST
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Telegram chat id"
              name="telegramChatId"
              defaultValue={alertPrefs?.telegramChatId ?? ""}
              placeholder="Detect it after messaging the bot"
            />
            <SaveButton>Save alerts</SaveButton>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {channels.telegram ? (
            <form action={detectTelegramChat}>
              <button type="submit" className="rounded-lg border border-line px-3 py-1.5 hover:bg-accent-soft">
                Detect my Telegram chat (send the bot any message first)
              </button>
            </form>
          ) : null}
          <form action={sendTestDigest}>
            <button type="submit" className="rounded-lg border border-line px-3 py-1.5 hover:bg-accent-soft">
              Send a test digest now
            </button>
          </form>
        </div>
      </Section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-semibold">Gmail</h2>
        {gmail.connected ? (
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span>
              Connected as <span className="font-mono">{gmail.email}</span>. Outreach drafts land
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
              only; Sifarish cannot read your email).
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
          Deleting your account removes your profile, preferences, resumes, contacts, outreach
          history, and applications permanently.
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

function Section({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{body}</p>
      {children}
    </section>
  );
}

function SaveButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="self-start rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
    >
      {children}
    </button>
  );
}

function BandSelect({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="flex items-center gap-2">
      {label}
      <select name={name} defaultValue={defaultValue} className="rounded-lg border border-line bg-white px-2 py-1 font-normal">
        <option value="strong">Strong</option>
        <option value="good">Good</option>
        <option value="maybe">Maybe</option>
      </select>
    </label>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="accent-accent" />
      {label}
    </label>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-lg border border-line bg-white px-3 py-2 font-normal"
      />
    </label>
  );
}
