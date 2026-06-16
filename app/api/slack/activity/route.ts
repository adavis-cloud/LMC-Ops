import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { kvConfigured } from "@/lib/kv";
import { recentActions } from "@/lib/slack-store";

/** GET — recent Slack-triggered actions for the web app activity feed. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!kvConfigured()) return NextResponse.json({ actions: [] });
  try {
    return NextResponse.json({ actions: await recentActions() });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load activity" },
      { status: 502 },
    );
  }
}
