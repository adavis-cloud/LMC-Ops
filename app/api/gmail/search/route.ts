import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchMessages } from "@/lib/gmail";

/**
 * Default search aimed at catering / wholesale inquiries.
 * This is a first pass — we'll tighten it (e.g. `from:` the Square notifier
 * address) once we see a real Square contact-form email.
 */
const DEFAULT_QUERY =
  '(catering OR wholesale OR "contact form" OR inquiry OR "new submission") newer_than:1y';

export async function GET(req: NextRequest) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json(
      { error: "Session expired — please sign in again." },
      { status: 401 },
    );
  }
  if (!session.accessToken) {
    return NextResponse.json(
      { error: "No Google access token on session." },
      { status: 403 },
    );
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() || DEFAULT_QUERY;

  try {
    const messages = await searchMessages(session.accessToken, q, 25);
    return NextResponse.json({ query: q, count: messages.length, messages });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gmail search failed" },
      { status: 502 },
    );
  }
}
