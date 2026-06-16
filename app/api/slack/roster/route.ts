import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listSlackUsers } from "@/lib/slack";
import { getSlackInstall, getRoster, setRoster, RosterEntry } from "@/lib/slack-store";
import { listUsers } from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";

/**
 * GET  — { roster, slackUsers, asanaUsers } for the mapping editor.
 * POST — { roster: RosterEntry[] } to save the Slack→Asana mapping.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const install = await getSlackInstall();
  if (!install) {
    return NextResponse.json({ error: "Slack not connected" }, { status: 403 });
  }
  const asanaToken = await getValidAccessToken();
  if (!asanaToken) {
    return NextResponse.json({ error: "Asana not connected" }, { status: 403 });
  }

  try {
    const [slackUsers, asanaUsers, roster] = await Promise.all([
      listSlackUsers(install.access_token),
      listUsers(asanaToken),
      getRoster(),
    ]);
    return NextResponse.json({ roster, slackUsers, asanaUsers });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load people" },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { roster } = await req.json().catch(() => ({}));
  if (!Array.isArray(roster)) {
    return NextResponse.json({ error: "roster must be an array" }, { status: 400 });
  }

  const clean: RosterEntry[] = roster
    .filter(
      (r) =>
        r &&
        typeof r.slackUserId === "string" &&
        typeof r.asanaGid === "string" &&
        r.asanaGid,
    )
    .map((r) => ({
      slackUserId: String(r.slackUserId),
      slackName: String(r.slackName ?? ""),
      asanaGid: String(r.asanaGid),
      asanaName: String(r.asanaName ?? ""),
    }));

  try {
    await setRoster(clean);
    return NextResponse.json({ ok: true, count: clean.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save roster" },
      { status: 502 },
    );
  }
}
