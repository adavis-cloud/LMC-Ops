import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listProjects } from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";

/** GET /api/asana/projects — non-archived projects for the project picker. */
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
    const projects = await listProjects(accessToken);
    return NextResponse.json({ projects });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Asana request failed" },
      { status: 502 },
    );
  }
}
