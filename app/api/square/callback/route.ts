import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { exchangeCode } from "@/lib/square";
import { writeSquareToken } from "@/lib/square-session";

/** Square redirects back here with ?code & ?state after the user authorizes. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get("square_oauth_state")?.value;
  store.delete("square_oauth_state");

  const home = (params = "") =>
    NextResponse.redirect(new URL(`/${params}`, url.origin));

  if (url.searchParams.get("error")) return home("?square=denied");
  if (!code || !state || state !== expectedState) return home("?square=error");

  try {
    const redirectUri = `${url.origin}/api/square/callback`;
    const token = await exchangeCode(code, redirectUri);
    await writeSquareToken(token);
    return home("?square=connected");
  } catch (err) {
    console.error("Square callback failed", err);
    return home("?square=error");
  }
}
