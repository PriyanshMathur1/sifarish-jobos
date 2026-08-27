import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Tracker" };

export default function TrackerPage() {
  return (
    <EmptyState
      title="Nothing tracked yet"
      body="Save or apply to a role to start your tracker. Applications keep a snapshot of the listing even if the company removes it."
    />
  );
}
