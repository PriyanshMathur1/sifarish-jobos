import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JobOS", template: "%s · JobOS" },
  description: "Your job search, one place: real openings, real contacts, customised outreach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
