import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { loadConfig } from "@sifarish/core";
import { buildGoogleAuthUrl, gmailScopes } from "@/lib/gmail";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/signin", process.env.APP_URL));
  const config = loadConfig();
  if (!config.GMAIL_OAUTH_CLIENT_ID) {
    return NextResponse.json(
      { error: "Gmail is not configured — set GMAIL_OAUTH_CLIENT_ID/SECRET (see DEPLOYMENT.md)" },
      { status: 501 },
    );
  }
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("gmail_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  const redirectUri = `${config.APP_URL}/api/gmail/callback`;
  const url = buildGoogleAuthUrl(
    config.GMAIL_OAUTH_CLIENT_ID,
    redirectUri,
    state,
    gmailScopes(config.OUTREACH_DIRECT_SEND),
  );
  return NextResponse.redirect(url);
}
