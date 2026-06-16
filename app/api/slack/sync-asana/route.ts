import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { kvConfigured } from "@/lib/kv";
import { getValidAccessToken, readAsanaToken } from "@/lib/asana-session";
import { setAsanaTokenKV } from "@/lib/asana-store";

/**
 * POST — copy the current (cookie) Asana token into KV so Slack-triggered
 * automation can use it. Normally this happens automatically when the Asana
 * page loads, but this gives an explicit "link now" button.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!kvConfigured()) {
    return NextResponse.json({ error: "KV not configured" }, { status: 503 });
  }
  // Trigger a refresh-if-needed, then persist whatever the cookie holds.
  await getValidAccessToken();
  const token = await readAsanaToken();
  if (!token) {
    return NextResponse.json({ error: "Asana not connected" }, { status: 403 });
  }
  try {
    await setAsanaTokenKV(token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to link Asana" },
      { status: 502 },
    );
  }
}
