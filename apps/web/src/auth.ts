import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { createTransport } from "nodemailer";
import { getDb, schema } from "@sifarish/db";
import { logger } from "@sifarish/core";

/**
 * Auth (PRD §10): Google OAuth + email magic link, DB sessions.
 * Mailer seam (grill G9): with SMTP_URL absent (dev), the magic link is
 * logged instead of sent — sign-in stays fully functional offline.
 */
const db = getDb();

const providers: Provider[] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

providers.push(
  Nodemailer({
    // dotenv yields "" for blank vars — `||` treats that as unset.
    server: process.env.SMTP_URL || "smtp://localhost:1025",
    from: "Sifarish <login@sifarish.local>",
    async sendVerificationRequest({ identifier, url, provider }) {
      if (!process.env.SMTP_URL) {
        // Dev adapter: log the link. Never enabled silently in prod —
        // prod sign-in is Google until SMTP_URL is configured.
        logger.info({ email: identifier, url }, "magic link (dev mailer)");
        console.log(`\n  ▶ Magic link for ${identifier}:\n  ${url}\n`);
        return;
      }
      const transport = createTransport(provider.server);
      await transport.sendMail({
        to: identifier,
        from: provider.from,
        subject: "Sign in to Sifarish",
        text: `Sign in to Sifarish:\n${url}\n\nIf you did not request this, ignore this email.`,
      });
    },
  }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "database" },
  providers,
  pages: { signIn: "/signin" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  trustHost: true,
});
