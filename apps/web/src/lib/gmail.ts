import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@sifarish/db";
import { FakeGmailClient, gmailClientForUser, gmailScopesFor, hasScope, GMAIL_SCOPE, loadConfig, type GmailClient } from "@sifarish/core";

/**
 * Gmail account plumbing (grill G5): tokens live encrypted in
 * email_accounts; this module is the only place they are decrypted.
 *
 * GMAIL_TEST_FAKE=true swaps in the in-memory fake — E2E/CI only, so the
 * approval flow is testable without Google. Never set it in production.
 */

const sharedFake = new FakeGmailClient();

export async function getGmailStatus(
  userId: string,
): Promise<{ connected: boolean; email?: string; canSend?: boolean; canReadMeta?: boolean }> {
  if (process.env.GMAIL_TEST_FAKE === "true")
    return { connected: true, email: "fake@test.local", canSend: true, canReadMeta: true };
  const db = getDb();
  const [row] = await db
    .select({ email: schema.emailAccounts.email, scopes: schema.emailAccounts.scopes })
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.userId, userId), isNull(schema.emailAccounts.revokedAt)));
  return row
    ? {
        connected: true,
        email: row.email,
        canSend: hasScope(row.scopes, GMAIL_SCOPE.send),
        canReadMeta: hasScope(row.scopes, GMAIL_SCOPE.metadata),
      }
    : { connected: false };
}

export async function getGmailClientForUser(userId: string): Promise<GmailClient | null> {
  if (process.env.GMAIL_TEST_FAKE === "true") return sharedFake;
  const found = await gmailClientForUser(getDb(), loadConfig(), userId);
  return found?.client ?? null;
}

/** Scopes the connect flow asks for; see gmailScopesFor in core. */
export function gmailScopes(directSend: boolean): string[] {
  return gmailScopesFor({ OUTREACH_DIRECT_SEND: directSend });
}

export function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scopes: string[],
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
