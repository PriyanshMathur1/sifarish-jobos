"use client";

/** Never show raw technical errors (PRD §115). The real error is logged server-side. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">
        That was on us, not you. Try again — if it keeps happening, the details are in the logs.
      </p>
      <button
        onClick={reset}
        className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:opacity-90"
      >
        Retry
      </button>
    </main>
  );
}
