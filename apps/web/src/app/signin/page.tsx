import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { CheckIcon, BuildingIcon, MailIcon } from "@/components/icons";

export const metadata = { title: "Sign in" };

const proofPoints = [
  { icon: BuildingIcon, text: "52 companies tracked, straight from Greenhouse, Lever & Ashby" },
  { icon: CheckIcon, text: "Honest email confidence, never a guarantee dressed up as fact" },
  { icon: MailIcon, text: "One message per person, drafts land in your own Gmail" },
];

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID);

  return (
    <main className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-[38%] min-w-[420px] flex-col justify-between overflow-hidden bg-ink px-12 py-14 text-paper lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(#e8eefc 1px, transparent 1px), linear-gradient(90deg, #e8eefc 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />

        <div className="relative flex items-center gap-2">
          <CheckIcon className="h-[22px] w-[22px]" />
          <span className="text-sm font-semibold tracking-wide">SIFARISH</span>
        </div>

        <div className="relative">
          <p className="font-display max-w-md text-4xl leading-tight tracking-tight">
            Real openings. Real people. Outreach you approve.
          </p>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[#c8c7c1]">
            Sifarish tracks live career pages across India&rsquo;s fastest-growing companies,
            finds the right person to email, and never sends a word without you reading it
            first.
          </p>

          <div className="mt-10 flex flex-col gap-3.5">
            {proofPoints.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-[15px] w-[15px] text-accent-soft" />
                </span>
                <span className="text-[13.5px] text-[#e6e5e0]">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-[#8a897f]">
          Built for the India job market · sifarish.priyanshmathur.com
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-[28px] tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-muted">
            Sign in to see today&rsquo;s openings and pick up where you left off.
          </p>

          {googleEnabled ? (
            <form
              className="mt-8"
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/feed" });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-white px-4 py-3 font-medium shadow-sm hover:bg-accent-soft/40"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.87c2.27-2.09 3.58-5.17 3.58-8.81z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.87-3c-1.08.72-2.45 1.15-4.08 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24z"
                  />
                  <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.27a12 12 0 0 0 0 10.74z" />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.63l4 3.1C6.22 6.86 8.87 4.75 12 4.75z"
                  />
                </svg>
                Continue with Google
              </button>
            </form>
          ) : null}

          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-xs uppercase tracking-wide text-muted">or</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <form
            action={async (formData: FormData) => {
              "use server";
              const { z } = await import("zod");
              const email = z.string().email().max(320).parse(formData.get("email"));
              await signIn("nodemailer", { email, redirectTo: "/feed" });
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
              className="rounded-lg border border-line bg-white px-3.5 py-3"
            />
            <button
              type="submit"
              className="rounded-lg border border-line bg-white px-4 py-3 font-medium hover:bg-accent-soft/40"
            >
              Send sign-in link
            </button>
          </form>

          <p className="mt-8 text-center text-xs leading-relaxed text-muted">
            By continuing you agree Sifarish only emails from your own Gmail, on your explicit
            approval.
          </p>
        </div>
      </div>
    </main>
  );
}
