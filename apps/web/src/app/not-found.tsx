import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link href="/jobs" className="text-accent underline">
        Back to jobs
      </Link>
    </main>
  );
}
