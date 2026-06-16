import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { exchangeCode } from "@/lib/asana";
import { writeAsanaToken } from "@/lib/asana-session";

/** Asana redirects back here with ?code & ?state after the user authorizes. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get("asana_oauth_state")?.value;
  store.delete("asana_oauth_state");

  const home = (params = "") =>
    NextResponse.redirect(new URL(`/asana${params}`, url.origin));

  if (url.searchParams.get("error")) return home("?asana=denied");
  if (!code || !state || state !== expectedState) return home("?asana=error");

  try {
    const redirectUri = `${url.origin}/api/asana/callback`;
    const { token } = await exchangeCode(code, redirectUri);
    await writeAsanaToken(token);
    return home("?asana=connected");
  } catch (err) {
    console.error("Asana callback failed", err);
    return home("?asana=error");
  }
}
