import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMessage } from "@/lib/gmail";
import { addComment } from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";
import { buildNotes } from "@/lib/draft";

/**
 * POST { taskGid, messageId } — add an email's content as a comment on a task.
 * Pulls the email server-side so the comment text is the same cleaned content
 * used elsewhere.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const asanaToken = await getValidAccessToken();
  if (!asanaToken) {
    return NextResponse.json({ error: "Asana not connected" }, { status: 403 });
  }

  const { taskGid, messageId } = await req.json().catch(() => ({}));
  if (!taskGid || !messageId) {
    return NextResponse.json(
      { error: "Missing taskGid or messageId" },
      { status: 400 },
    );
  }

  try {
    const message = await getMessage(session.accessToken, messageId);
    const received = message.date ? ` · ${message.date}` : "";
    const text = `Email logged from Connector — "${message.subject}"${received}\n\n${buildNotes(message)}`;
    await addComment(asanaToken, taskGid, text);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add comment" },
      { status: 502 },
    );
  }
}
