import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Contacts" };

export default function ContactsPage() {
  return (
    <EmptyState
      title="No contacts yet"
      body="Add recruiters and hiring managers you find, and JobOS will suggest probable work emails with honest confidence labels. Coming in Phase 2."
    />
  );
}
