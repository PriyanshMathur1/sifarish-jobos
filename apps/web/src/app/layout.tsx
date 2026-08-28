import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sifarish", template: "%s · Sifarish" },
  description: "Your job search, one place: real openings, real contacts, customised outreach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Display face for headings only (see .font-display in globals.css) —
            body text stays the system-ui stack. A plain stylesheet link, not
            next/font, so a build never depends on reaching Google Fonts. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
