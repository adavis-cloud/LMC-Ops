import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { authorizeUrl } from "@/lib/square";
import { isSquareConfigured } from "@/lib/square-session";

/** Kick off the Square OAuth flow. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
  if (!isSquareConfigured()) {
    return NextResponse.redirect(new URL("/?square=unconfigured", req.nextUrl.origin));
  }

  const state = randomUUID();
  (await cookies()).set("square_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const redirectUri = `${req.nextUrl.origin}/api/square/callback`;
  return NextResponse.redirect(authorizeUrl(redirectUri, state));
}
