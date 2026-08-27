import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <EmptyState
      title="No jobs ingested yet"
      body="The job pipeline arrives in Phase 1. Once seed companies are refreshed, every opening from their career boards shows up here — searchable and filtered to India."
    />
  );
}
