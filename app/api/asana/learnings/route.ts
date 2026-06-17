import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { kvConfigured } from "@/lib/kv";
import { forget, listLearnings } from "@/lib/match-memory";

/** GET — every stored match correction, for the "what I've learned" view. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  try {
    const learned = await listLearnings();
    return NextResponse.json({ configured: kvConfigured(), learned });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load learnings" },
      { status: 502 },
    );
  }
}

/**
 * DELETE { key, verdict, gid? } — undo a correction. With a gid, drops just
 * that task from the key; without one, forgets the whole key.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { key, verdict, gid } = await req.json().catch(() => ({}));
  if (
    !key ||
    typeof key !== "string" ||
    (verdict !== "confirm" && verdict !== "reject")
  ) {
    return NextResponse.json(
      { error: "key and verdict ('confirm'|'reject') are required" },
      { status: 400 },
    );
  }
  try {
    await forget(key, verdict, typeof gid === "string" ? gid : undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to forget" },
      { status: 502 },
    );
  }
}
