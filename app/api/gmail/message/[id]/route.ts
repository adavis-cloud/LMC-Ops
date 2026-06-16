import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMessage } from "@/lib/gmail";
import { searchTasks, AsanaTask } from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";
import { matchTasks, EmailFields } from "@/lib/match";

/** "Jane <jane@x.com> via orders <...>" -> { name, email } for the customer. */
function parseSender(from: string, subject: string) {
  const emailMatch = from.match(/<([^>]+@[^>]+)>/);
  let email = emailMatch?.[1] ?? "";
  if (!email) {
    const bare = from.match(/[\w.+-]+@[\w.-]+\.\w+/);
    email = bare?.[0] ?? "";
  }
  let name = (from.split("<")[0] ?? "")
    .replace(/"/g, "")
    .replace(/\s+via\s+\S+.*$/i, "")
    .trim();

  // Square form notifications carry the real customer in the subject:
  //   "New Form Entry from danny@x.com: Contact us"
  const square = subject.match(/New Form Entry from\s+([^:]+):/i);
  if (square) {
    email = square[1].trim();
    name = "";
  }
  return { name, email };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const message = await getMessage(session.accessToken, id);
    const { name, email } = parseSender(message.from, message.subject);

    // Check Asana for a corresponding task (only if connected).
    const asanaToken = await getValidAccessToken();
    let asana;
    if (!asanaToken) {
      asana = { connected: false as const };
    } else {
      const queries = Array.from(new Set([name, email].filter(Boolean)));
      const seen = new Set<string>();
      const candidates: AsanaTask[] = [];
      for (const q of queries) {
        for (const t of await searchTasks(asanaToken, q)) {
          if (!seen.has(t.gid)) {
            seen.add(t.gid);
            candidates.push(t);
          }
        }
      }
      const email_: EmailFields = {
        subject: message.subject,
        senderName: name,
        senderEmail: email,
      };
      asana = { connected: true as const, ...matchTasks(email_, candidates) };
    }

    return NextResponse.json({ message, asana });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load message" },
      { status: 502 },
    );
  }
}
