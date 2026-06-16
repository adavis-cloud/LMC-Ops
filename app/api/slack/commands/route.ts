import { NextRequest, NextResponse } from "next/server";
import {
  verifySlackRequest,
  slackApi,
  buildCreateTaskModal,
  optionFor,
  parseDueDate,
  deriveTaskName,
} from "@/lib/slack";
import { getSlackInstall, getRoster } from "@/lib/slack-store";

/** Slash command `/task <text>` — opens the create-task modal pre-filled. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (
    !verifySlackRequest(
      raw,
      req.headers.get("x-slack-signature"),
      req.headers.get("x-slack-request-timestamp"),
    )
  ) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  const body = new URLSearchParams(raw);
  const triggerId = body.get("trigger_id");
  const text = body.get("text") ?? "";
  const userId = body.get("user_id") ?? "";
  const userName = body.get("user_name") ?? "someone";

  const install = await getSlackInstall();
  if (!install) {
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Slack isn't connected to the Connector yet — ask an admin to connect it.",
    });
  }

  const roster = await getRoster();
  const assigneeOptions = roster.map((r) => optionFor(r.asanaName, r.asanaGid));

  const view = buildCreateTaskModal({
    taskName: text ? deriveTaskName(text) : "",
    notesDefault: "",
    dueDefault: parseDueDate(text),
    assigneeOptions,
    initialAssignee: null,
    privateMetadata: JSON.stringify({ by: userName, userId }),
  });

  await slackApi(install.access_token, "views.open", { trigger_id: triggerId, view });
  return new NextResponse(null, { status: 200 });
}
