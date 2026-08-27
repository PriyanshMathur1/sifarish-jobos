import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb, schema } from "@jobos/db";
import { eq } from "drizzle-orm";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const db = getDb();
  const [me] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id));
  if (me?.role !== "admin") redirect("/jobs");

  return (
    <EmptyState
      title="Admin"
      body="Source health, refresh runs, and retry controls arrive with the ingestion pipeline in Phase 1."
    />
  );
}
