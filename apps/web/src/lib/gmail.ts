import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@jobos/db";
import {
  RealGmailClient,
  FakeGmailClient,
  decryptToken,
  encryptToken,
  loadConfig,
  type GmailClient,
  type TokenBundle,
} from "@jobos/core";

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
): Promise<{ connected: boolean; email?: string }> {
  if (process.env.GMAIL_TEST_FAKE === "true") return { connected: true, email: "fake@test.local" };
  const db = getDb();
  const [row] = await db
    .select({ email: schema.emailAccounts.email })
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.userId, userId), isNull(schema.emailAccounts.revokedAt)));
  return row ? { connected: true, email: row.email } : { connected: false };
}

export async function getGmailClientForUser(userId: string): Promise<GmailClient | null> {
  if (process.env.GMAIL_TEST_FAKE === "true") return sharedFake;

  const config = loadConfig();
  if (
    !config.GMAIL_OAUTH_CLIENT_ID ||
    !config.GMAIL_OAUTH_CLIENT_SECRET ||
    !config.TOKEN_ENCRYPTION_KEY
  ) {
    return null;
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.userId, userId), isNull(schema.emailAccounts.revokedAt)));
  if (!row) return null;

  const tokens = JSON.parse(
    decryptToken(row.oauthTokensEnc, config.TOKEN_ENCRYPTION_KEY),
  ) as TokenBundle;
  return new RealGmailClient({
    tokens,
    clientId: config.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: config.GMAIL_OAUTH_CLIENT_SECRET,
    onTokensRefreshed: async (fresh) => {
      await db
        .update(schema.emailAccounts)
        .set({ oauthTokensEnc: encryptToken(JSON.stringify(fresh), config.TOKEN_ENCRYPTION_KEY!) })
        .where(eq(schema.emailAccounts.id, row.id));
    },
  });
}

export function gmailScopes(directSend: boolean): string[] {
  // Minimum necessary (PRD §78): compose covers draft creation; send only
  // when the direct-send flag is deliberately enabled.
  const scopes = ["https://www.googleapis.com/auth/gmail.compose"];
  if (directSend) scopes.push("https://www.googleapis.com/auth/gmail.send");
  return scopes;
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
