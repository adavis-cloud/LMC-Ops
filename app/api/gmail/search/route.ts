import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchMessages } from "@/lib/gmail";
import { FILTERS, rankByUrgency } from "@/lib/filters";

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

  // Resolve the query: a named filter, "show all", a typed query, or default.
  const filterKey = req.nextUrl.searchParams.get("filter");
  const filter = filterKey ? FILTERS[filterKey] : undefined;
  const showAll = req.nextUrl.searchParams.get("all");
  const typed = req.nextUrl.searchParams.get("q")?.trim();

  const q = filter ? filter.query : showAll ? "in:inbox" : typed || DEFAULT_QUERY;
  const ranked = !!filter?.ranked;

  try {
    // Ranked filters cast a wider net since scoring decides what surfaces.
    const messages = await searchMessages(session.accessToken, q, ranked ? 40 : 25);
    const result = ranked ? rankByUrgency(messages) : messages;
    return NextResponse.json({
      filter: filterKey ?? null,
      query: q,
      count: result.length,
      messages: result,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gmail search failed" },
      { status: 502 },
    );
  }
}
