import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { authorizeUrl } from "@/lib/slack";

/** Start the Slack OAuth install flow. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const state = randomUUID();
  (await cookies()).set("slack_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const redirectUri = `${req.nextUrl.origin}/api/slack/callback`;
  return NextResponse.redirect(authorizeUrl(redirectUri, state));
}
