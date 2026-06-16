import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createTask,
  findProjectGid,
  listSections,
  PINNED_PROJECT_NAME,
} from "@/lib/asana";
import { getValidAccessToken } from "@/lib/asana-session";

/**
 * POST { name, notes, dueOn, section } — create a task in Outgoing Activity.
 * Section is matched by name to one of the project's sections (optional).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Asana not connected" }, { status: 403 });
  }

  const { name, notes, dueOn, section } = await req.json().catch(() => ({}));
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Task name is required" }, { status: 400 });
  }

  try {
    const projectGid = await findProjectGid(accessToken, PINNED_PROJECT_NAME);

    let sectionGid: string | null = null;
    if (section) {
      const sections = await listSections(accessToken, projectGid);
      sectionGid =
        sections.find(
          (s) => s.name.trim().toLowerCase() === String(section).trim().toLowerCase(),
        )?.gid ?? null;
    }

    const task = await createTask(accessToken, {
      name: name.trim(),
      notes: typeof notes === "string" ? notes : "",
      dueOn: dueOn || null,
      projectGid,
      sectionGid,
    });
    return NextResponse.json({ ok: true, task });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create task" },
      { status: 502 },
    );
  }
}
