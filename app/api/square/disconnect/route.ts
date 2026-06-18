import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearSquareToken } from "@/lib/square-session";

/** Forget the stored Square token (local disconnect). */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  await clearSquareToken();
  return NextResponse.json({ ok: true });
}
