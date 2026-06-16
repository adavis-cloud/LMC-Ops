import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { authorizeUrl } from "@/lib/asana";

/** Kick off the Asana OAuth flow. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const state = randomUUID();
  (await cookies()).set("asana_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  const redirectUri = `${req.nextUrl.origin}/api/asana/callback`;
  return NextResponse.redirect(authorizeUrl(redirectUri, state));
}
