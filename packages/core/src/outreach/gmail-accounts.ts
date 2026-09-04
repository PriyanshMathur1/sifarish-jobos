import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@sifarish/db";
import type { AppConfig } from "../config.ts";
import { decryptToken, encryptToken } from "./token-crypto.ts";
import { RealGmailClient, type GmailClient, type TokenBundle } from "./gmail.ts";

/**
 * The one place OAuth tokens are decrypted. Web actions and worker handlers
 * both go through here so campaigns can send without a browser session.
 */
export async function gmailAccountForUser(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.userId, userId), isNull(schema.emailAccounts.revokedAt)));
  return row ?? null;
}

export async function gmailClientForUser(
  db: Db,
  config: AppConfig,
  userId: string,
): Promise<{ client: GmailClient; email: string; scopes: string[] } | null> {
  if (!config.GMAIL_OAUTH_CLIENT_ID || !config.GMAIL_OAUTH_CLIENT_SECRET || !config.TOKEN_ENCRYPTION_KEY) {
    return null;
  }
  const row = await gmailAccountForUser(db, userId);
  if (!row) return null;
  const key = config.TOKEN_ENCRYPTION_KEY;
  const tokens = JSON.parse(decryptToken(row.oauthTokensEnc, key)) as TokenBundle;
  const client = new RealGmailClient({
    tokens,
    clientId: config.GMAIL_OAUTH_CLIENT_ID,
    clientSecret: config.GMAIL_OAUTH_CLIENT_SECRET,
    onTokensRefreshed: async (fresh) => {
      await db
        .update(schema.emailAccounts)
        .set({ oauthTokensEnc: encryptToken(JSON.stringify(fresh), key) })
        .where(eq(schema.emailAccounts.id, row.id));
    },
  });
  return { client, email: row.email, scopes: row.scopes };
}

export const GMAIL_SCOPE = {
  compose: "https://www.googleapis.com/auth/gmail.compose",
  send: "https://www.googleapis.com/auth/gmail.send",
  /** headers and labels only, never bodies: what reply/bounce detection needs */
  metadata: "https://www.googleapis.com/auth/gmail.metadata",
} as const;

/** Minimum necessary: compose always; send + metadata only when direct send (campaigns) is on. */
export function gmailScopesFor(config: Pick<AppConfig, "OUTREACH_DIRECT_SEND">): string[] {
  const scopes: string[] = [GMAIL_SCOPE.compose];
  if (config.OUTREACH_DIRECT_SEND) scopes.push(GMAIL_SCOPE.send, GMAIL_SCOPE.metadata);
  return scopes;
}

export function hasScope(scopes: string[], scope: string): boolean {
  return scopes.includes(scope);
}
