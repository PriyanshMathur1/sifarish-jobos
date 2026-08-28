import Link from "next/link";
import { signOut } from "@/auth";
import { requireUser, isAdmin } from "@/lib/session";

const nav = [
  { href: "/jobs", label: "Jobs" },
  { href: "/contacts", label: "Contacts" },
  { href: "/outreach", label: "Outreach" },
  { href: "/tracker", label: "Tracker" },
  { href: "/profile", label: "Profile" },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await requireUser();
  const admin = await isAdmin(userId);

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link href="/jobs" className="font-semibold tracking-tight">
            Sifarish
          </Link>
          <nav className="hidden gap-1 sm:flex" aria-label="Primary">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-accent-soft hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
            {admin ? (
              <Link
                href="/admin"
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-accent-soft hover:text-ink"
              >
                Admin
              </Link>
            ) : null}
          </nav>
          <form
            className="ml-auto"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className="text-sm text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      {/* Mobile bottom nav (PRD §112) */}
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-line bg-paper py-2 sm:hidden"
      >
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="px-2 py-1 text-xs text-muted">
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
