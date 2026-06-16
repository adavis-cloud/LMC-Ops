import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { kvConfigured } from "@/lib/kv";
import { recordConfirm, recordReject } from "@/lib/match-memory";

/**
 * POST { customerKey, taskGid, section?, verdict: "confirm" | "reject" }
 * Records the user's correction so future matches for this customer improve.
 * No-ops (still 200) when KV isn't configured, so the UI can call it blindly.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { customerKey, taskGid, section, verdict } = await req
    .json()
    .catch(() => ({}));

  if (
    !customerKey ||
    typeof customerKey !== "string" ||
    !taskGid ||
    typeof taskGid !== "string" ||
    (verdict !== "confirm" && verdict !== "reject")
  ) {
    return NextResponse.json(
      { error: "customerKey, taskGid and verdict ('confirm'|'reject') are required" },
      { status: 400 },
    );
  }

  try {
    if (verdict === "reject") {
      await recordReject(customerKey, taskGid);
    } else {
      await recordConfirm(customerKey, taskGid, typeof section === "string" ? section : undefined);
    }
    // `learned` tells the UI whether the correction actually persisted.
    return NextResponse.json({ ok: true, learned: kvConfigured() });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save feedback" },
      { status: 502 },
    );
  }
}
