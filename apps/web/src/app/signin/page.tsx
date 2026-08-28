import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/jobs");

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Sifarish</h1>
        <p className="mt-2 text-muted">
          Real openings from company career sources. Real contacts. Outreach you approve.
        </p>
      </div>

      {googleEnabled ? (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/jobs" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-ink px-4 py-2.5 font-medium text-paper hover:opacity-90"
          >
            Continue with Google
          </button>
        </form>
      ) : null}

      <form
        action={async (formData: FormData) => {
          "use server";
          const { z } = await import("zod");
          const email = z.string().email().max(320).parse(formData.get("email"));
          await signIn("nodemailer", { email, redirectTo: "/jobs" });
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="email" className="text-sm font-medium">
          Email magic link
          {process.env.SMTP_URL ? "" : " (dev: link is logged to the server console)"}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="rounded-lg border border-line bg-white px-3 py-2.5"
        />
        <button
          type="submit"
          className="rounded-lg border border-line bg-white px-4 py-2.5 font-medium hover:bg-accent-soft"
        >
          Send sign-in link
        </button>
      </form>
    </main>
  );
}
