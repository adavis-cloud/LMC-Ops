import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendSelfEmail } from "@/lib/gmail";

/**
 * POST { note, subject } — email a note to YOURSELF about an inquiry.
 * The recipient is forced to the signed-in user's address; sendSelfEmail
 * additionally refuses any other recipient, so this can never reach a customer.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const self = session?.user?.email;
  if (!session?.accessToken || !self) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { note, subject } = await req.json().catch(() => ({}));
  if (!note || typeof note !== "string" || !note.trim()) {
    return NextResponse.json({ error: "Note is empty" }, { status: 400 });
  }

  try {
    await sendSelfEmail(
      session.accessToken,
      self,
      self, // recipient = you, always
      `Note: ${subject ?? "inquiry"}`.slice(0, 120),
      note.trim(),
    );
    return NextResponse.json({ ok: true, sentTo: self });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send note" },
      { status: 502 },
    );
  }
}
