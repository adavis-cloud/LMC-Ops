import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMessage, modifyLabels, GmailScopeError } from "@/lib/gmail";
import {
  getMyTasks,
  getProjectTasksByName,
  PINNED_PROJECT_NAME,
  AsanaTask,
} from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";
import { matchTasks, EmailFields } from "@/lib/match";
import { learningKeysFor, loadMatchMemory } from "@/lib/match-memory";
import { buildTaskDraft } from "@/lib/draft";
import { parseInquiry } from "@/lib/parse";
import { findInvoicesForEmail } from "@/lib/square";
import { getValidSquareToken } from "@/lib/square-session";

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
    const parsed = parseInquiry(message);

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
      // Apply anything we've learned for this customer / org from past
      // corrections, across exact-email, domain, and org-name keys.
      const learnKeys = learningKeysFor({
        senderEmail: parsed.email,
        selfEmail: session.user?.email,
        subject: parsed.subject,
        body: message.body,
      });
      const memory = await loadMatchMemory(learnKeys);

      const fields: EmailFields = {
        subject: parsed.subject,
        senderName: parsed.contactName,
        senderEmail: parsed.email,
        business: parsed.business,
        body: message.body,
        selfEmail: session.user?.email ?? undefined,
        emailDate: message.date,
        memory,
      };
      // learnKeys is echoed back so feedback writes to the same keys we read.
      asana = {
        connected: true as const,
        learnKeys,
        ...matchTasks(fields, candidates),
      };
    }

    const draftTask = buildTaskDraft(parsed);

    // Cross-check Square for an existing invoice for this same customer — uses
    // the same parsed email that drives the Asana match, so they stay in sync.
    let square;
    const squareToken = await getValidSquareToken();
    if (!squareToken) {
      square = { connected: false as const };
    } else {
      try {
        const invoices = parsed.email
          ? await findInvoicesForEmail(squareToken, parsed.email)
          : [];
        square = { connected: true as const, customerEmail: parsed.email, invoices };
      } catch (err) {
        console.error("Square invoice lookup failed", err);
        square = { connected: true as const, customerEmail: parsed.email, invoices: [], error: true };
      }
    }

    return NextResponse.json({ message, asana, draftTask, square });
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
    if (err instanceof GmailScopeError) {
      return NextResponse.json({ error: err.message, reauth: true }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 502 },
    );
  }
}
