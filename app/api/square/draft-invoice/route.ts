import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prepareDraftInvoice } from "@/lib/square";
import { getValidSquareToken } from "@/lib/square-session";

/**
 * POST { email, name, title } — create a DRAFT invoice in Square for this
 * customer and return a deep-link. We never publish/send; the user finalizes
 * line items + amounts and sends from Square.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const token = await getValidSquareToken();
  if (!token) {
    return NextResponse.json({ error: "Square not connected" }, { status: 403 });
  }

  const { email, name, title } = await req.json().catch(() => ({}));
  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { error: "A customer email is required to create an invoice" },
      { status: 400 },
    );
  }

  try {
    const draft = await prepareDraftInvoice(token, {
      email,
      name: typeof name === "string" ? name : "",
      title: typeof title === "string" ? title : "Order",
    });
    return NextResponse.json({ ok: true, ...draft });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create draft invoice" },
      { status: 502 },
    );
  }
}
