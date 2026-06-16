import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findProjectGid, listSections, PINNED_PROJECT_NAME } from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";

/** GET /api/asana/sections — sections of Outgoing Activity (for the dropdown). */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Asana not connected" }, { status: 403 });
  }

  try {
    const projectGid = await findProjectGid(accessToken, PINNED_PROJECT_NAME);
    const sections = await listSections(accessToken, projectGid);
    return NextResponse.json({ sections });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load sections" },
      { status: 502 },
    );
  }
}
