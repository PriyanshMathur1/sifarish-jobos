import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Outreach" };

export default function OutreachPage() {
  return (
    <EmptyState
      title="No outreach yet"
      body="Pick a job, pick a contact, pick a template — JobOS fills the variables and puts the email in your Gmail drafts. You always approve every send."
    />
  );
}
