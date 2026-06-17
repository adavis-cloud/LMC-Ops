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

  const { keys, taskGid, taskName, section, verdict } = await req
    .json()
    .catch(() => ({}));

  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some((k) => typeof k !== "string") ||
    !taskGid ||
    typeof taskGid !== "string" ||
    (verdict !== "confirm" && verdict !== "reject")
  ) {
    return NextResponse.json(
      { error: "keys[], taskGid and verdict ('confirm'|'reject') are required" },
      { status: 400 },
    );
  }

  try {
    const name = typeof taskName === "string" ? taskName : undefined;
    const sect = typeof section === "string" ? section : undefined;
    if (verdict === "reject") {
      await recordReject(keys, taskGid, name);
    } else {
      await recordConfirm(keys, taskGid, sect, name);
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
