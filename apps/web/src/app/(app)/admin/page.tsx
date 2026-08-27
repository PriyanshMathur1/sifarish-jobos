import { requireAdmin } from "@/lib/session";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();

  return (
    <EmptyState
      title="Admin"
      body="Source health, refresh runs, and retry controls arrive with the ingestion pipeline in Phase 1."
    />
  );
}
