import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getMyTasks,
  getProjectTasks,
  getProjectTasksByName,
  PINNED_PROJECT_NAME,
} from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";

/**
 * GET /api/asana/tasks?view=mine|due|project[&project=GID]
 * - mine    : incomplete tasks assigned to me
 * - due     : same, but only those with a due date, soonest first
 * - project : incomplete tasks in the given project
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Asana not connected" }, { status: 403 });
  }

  const view = req.nextUrl.searchParams.get("view") ?? "mine";
  const projectId = req.nextUrl.searchParams.get("project");

  try {
    let tasks;
    if (view === "outgoing") {
      tasks = await getProjectTasksByName(accessToken, PINNED_PROJECT_NAME);
    } else if (view === "project") {
      if (!projectId) {
        return NextResponse.json({ error: "Missing project" }, { status: 400 });
      }
      tasks = await getProjectTasks(accessToken, projectId);
    } else {
      tasks = await getMyTasks(accessToken, { dueOnly: view === "due" });
    }
    return NextResponse.json({ view, count: tasks.length, tasks });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Asana request failed" },
      { status: 502 },
    );
  }
}
