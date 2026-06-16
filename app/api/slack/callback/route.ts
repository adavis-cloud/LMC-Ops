import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { exchangeCode } from "@/lib/slack";
import { setSlackInstall } from "@/lib/slack-store";

/** Slack redirects back here with ?code & ?state after the admin installs. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get("slack_oauth_state")?.value;
  store.delete("slack_oauth_state");

  const home = (params = "") =>
    NextResponse.redirect(new URL(`/slack${params}`, url.origin));

  if (url.searchParams.get("error")) return home("?slack=denied");
  if (!code || !state || state !== expectedState) return home("?slack=error");

  try {
    const redirectUri = `${url.origin}/api/slack/callback`;
    const result = await exchangeCode(code, redirectUri);
    await setSlackInstall({
      access_token: result.access_token,
      team_id: result.team?.id ?? "",
      team_name: result.team?.name,
      bot_user_id: result.bot_user_id,
      authed_user_id: result.authed_user?.id,
      installed_at: Date.now(),
    });
    return home("?slack=connected");
  } catch (err) {
    console.error("Slack callback failed", err);
    return home("?slack=error");
  }
}
