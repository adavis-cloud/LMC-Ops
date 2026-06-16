import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMessage, modifyLabels } from "@/lib/gmail";
import {
  getMyTasks,
  getProjectTasksByName,
  PINNED_PROJECT_NAME,
  AsanaTask,
} from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";
import { matchTasks, EmailFields } from "@/lib/match";
import { buildTaskDraft } from "@/lib/draft";

/** Resolve the customer's { name, email } from the headers / Square form. */
function parseSender(from: string, subject: string, body: string) {
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

  // Square form notifications: the real customer is in the subject + body.
  //   subject: "New Form Entry from danny@x.com: Contact us"
  //   body:    "Full name\nDanny McGee\nEmail\ndanny@x.com\n..."
  if (/New Form Entry from/i.test(subject)) {
    const bodyName = body.match(/Full name\s*[:\n]+\s*(.+)/i);
    const bodyEmail = body.match(/Email\s*[:\n]+\s*([\w.+-]+@[\w.-]+\.\w+)/i);
    const subjEmail = subject.match(/New Form Entry from\s+([\w.+-]+@[\w.-]+\.\w+)/i);
    name = bodyName?.[1]?.trim() ?? "";
    email = (bodyEmail?.[1] ?? subjEmail?.[1] ?? email).trim();
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
    const { name, email } = parseSender(
      message.from,
      message.subject,
      message.body,
    );

    // Check Asana for a corresponding task (only if connected).
    const asanaToken = await getValidAccessToken();
    let asana;
    if (!asanaToken) {
      asana = { connected: false as const };
    } else {
      // Candidate pool from tasks we can already read (no extra Asana scope):
      // the user's assigned tasks + the pinned "Outgoing Activity" project.
      const pools = await Promise.allSettled([
        getMyTasks(asanaToken, { includeCompleted: true }),
        getProjectTasksByName(asanaToken, PINNED_PROJECT_NAME, {
          includeCompleted: true,
        }),
      ]);
      const seen = new Set<string>();
      const candidates: AsanaTask[] = [];
      for (const p of pools) {
        if (p.status !== "fulfilled") continue;
        for (const t of p.value) {
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

    const draftTask = buildTaskDraft(message, { name, email });

    return NextResponse.json({ message, asana, draftTask });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load message" },
      { status: 502 },
    );
  }
}

/** POST { action: "read" | "star" | "unstar" } — modify labels on a message. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));

  const changes: Record<string, { add?: string[]; remove?: string[] }> = {
    read: { remove: ["UNREAD"] },
    star: { add: ["STARRED"] },
    unstar: { remove: ["STARRED"] },
  };
  if (!changes[action]) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const labelIds = await modifyLabels(session.accessToken, id, changes[action]);
    return NextResponse.json({ labelIds });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 502 },
    );
  }
}
