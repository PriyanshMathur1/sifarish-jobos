import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { loadConfig, encryptToken, logger } from "@jobos/core";
import { getDb, schema, audit } from "@jobos/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  const config = loadConfig();
  if (!session?.user?.id) return NextResponse.redirect(`${config.APP_URL}/signin`);

  const jar = await cookies();
  const expectedState = jar.get("gmail_oauth_state")?.value;
  jar.delete("gmail_oauth_state");
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !state || state !== expectedState) {
    return NextResponse.redirect(`${config.APP_URL}/profile?gmail=state_mismatch`);
  }
  if (
    !config.GMAIL_OAUTH_CLIENT_ID ||
    !config.GMAIL_OAUTH_CLIENT_SECRET ||
    !config.TOKEN_ENCRYPTION_KEY
  ) {
    return NextResponse.redirect(`${config.APP_URL}/profile?gmail=unconfigured`);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.GMAIL_OAUTH_CLIENT_ID,
        client_secret: config.GMAIL_OAUTH_CLIENT_SECRET,
        redirect_uri: `${config.APP_URL}/api/gmail/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileRes.json()) as { emailAddress?: string };

    const bundle = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: Date.now() + tokens.expires_in * 1000,
    };
    const db = getDb();
    await db
      .insert(schema.emailAccounts)
      .values({
        userId: session.user.id,
        email: profile.emailAddress ?? "unknown",
        oauthTokensEnc: encryptToken(JSON.stringify(bundle), config.TOKEN_ENCRYPTION_KEY),
        scopes: tokens.scope.split(" "),
      })
      .onConflictDoUpdate({
        target: schema.emailAccounts.userId,
        set: {
          email: profile.emailAddress ?? "unknown",
          oauthTokensEnc: encryptToken(JSON.stringify(bundle), config.TOKEN_ENCRYPTION_KEY),
          scopes: tokens.scope.split(" "),
          revokedAt: null,
          connectedAt: new Date(),
        },
      });
    await audit(db, {
      actorId: session.user.id,
      action: "gmail.connect",
      subjectType: "email_account",
    });
    return NextResponse.redirect(`${config.APP_URL}/profile?gmail=connected`);
  } catch (e) {
    logger.error({ err: e }, "gmail oauth callback failed");
    return NextResponse.redirect(`${config.APP_URL}/profile?gmail=error`);
  }
}
