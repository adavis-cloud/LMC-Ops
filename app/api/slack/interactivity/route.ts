import { NextRequest, NextResponse } from "next/server";
import {
  verifySlackRequest,
  slackApi,
  buildCreateTaskModal,
  buildCommentModal,
  optionFor,
  parseDueDate,
  extractMentions,
  deriveTaskName,
} from "@/lib/slack";
import { getSlackInstall, getRoster, logAction } from "@/lib/slack-store";
import { getAsanaAutomationToken } from "@/lib/asana-store";
import {
  createTask,
  addComment,
  findProjectGid,
  getProjectTasksByName,
  PINNED_PROJECT_NAME,
} from "@/lib/asana";

const ok = () => new NextResponse(null, { status: 200 });
const errors = (e: Record<string, string>) =>
  NextResponse.json({ response_action: "errors", errors: e });

/**
 * Slack interactivity endpoint. Handles two message shortcuts:
 *   - create_asana_task  → opens a pre-filled "New Asana task" modal
 *   - comment_asana_task → opens a "Comment on task" modal
 * and their `view_submission`s, which create the task / add the comment via
 * the KV-stored Asana token (no browser session here — this is server-to-server).
 */
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

  const payload = parsePayload(raw);
  if (!payload) return ok();

  const install = await getSlackInstall();
  if (!install) return ok(); // not connected; nothing we can do
  const botToken = install.access_token;

  try {
    if (payload.type === "shortcut" || payload.type === "message_action") {
      await openModal(payload, botToken);
      return ok();
    }
    if (payload.type === "view_submission") {
      return await handleSubmission(payload);
    }
  } catch (err) {
    console.error("Slack interactivity failed", err);
    // For modal submits, surface the error in the modal instead of a silent fail.
    if (payload.type === "view_submission") {
      const block = payload.view?.callback_id === "submit_comment" ? "comment" : "name";
      return errors({ [block]: "Something went wrong. Please try again." });
    }
  }
  return ok();
}

// ---------------------------------------------------------------------------

async function openModal(payload: SlackPayload, botToken: string) {
  const cb = payload.callback_id;
  const message = payload.message;
  const channel = payload.channel?.id;
  const messageTs = message?.ts;
  const msgText = message?.text ?? "";

  let permalink: string | undefined;
  if (channel && messageTs) {
    try {
      const r = await slackApi<{ permalink?: string }>(botToken, "chat.getPermalink", {
        channel,
        message_ts: messageTs,
      });
      permalink = r.permalink;
    } catch {
      /* permalink is best-effort */
    }
  }

  const by =
    payload.user?.username || payload.user?.name || payload.user?.id || "someone";
  const meta = JSON.stringify({ channel, permalink, by, userId: payload.user?.id });

  if (cb === "comment_asana_task") {
    const asana = await getAsanaAutomationToken();
    let taskOptions: ReturnType<typeof optionFor>[] = [];
    if (asana) {
      try {
        const tasks = await getProjectTasksByName(asana, PINNED_PROJECT_NAME);
        taskOptions = tasks
          .slice(0, 100)
          .map((t) => optionFor(t.name || "(untitled task)", t.gid));
      } catch {
        /* leave empty; submission will explain */
      }
    }
    const commentDefault = msgText
      ? `From Slack (${by}): "${msgText}"${permalink ? `\n${permalink}` : ""}`
      : "";
    const view = buildCommentModal({ taskOptions, commentDefault, privateMetadata: meta });
    await slackApi(botToken, "views.open", { trigger_id: payload.trigger_id, view });
    return;
  }

  // Default: create_asana_task (also used by the /task slash command path).
  const roster = await getRoster();
  const assigneeOptions = roster.map((r) => optionFor(r.asanaName, r.asanaGid));

  // Default assignee: first @mention that's in the roster, else the message author.
  const candidates = [...extractMentions(msgText)];
  if (message?.user) candidates.push(message.user);
  let initialAssignee: ReturnType<typeof optionFor> | null = null;
  for (const sid of candidates) {
    const hit = roster.find((r) => r.slackUserId === sid);
    if (hit) {
      initialAssignee = optionFor(hit.asanaName, hit.asanaGid);
      break;
    }
  }

  const notesDefault = msgText
    ? `From Slack (${by}): "${msgText}"${permalink ? `\n\n${permalink}` : ""}`
    : permalink ?? "";

  const view = buildCreateTaskModal({
    taskName: deriveTaskName(msgText),
    notesDefault,
    dueDefault: parseDueDate(msgText),
    assigneeOptions,
    initialAssignee,
    privateMetadata: meta,
  });
  await slackApi(botToken, "views.open", { trigger_id: payload.trigger_id, view });
}

async function handleSubmission(payload: SlackPayload): Promise<NextResponse> {
  const view = payload.view!;
  const meta = safeJson<{ by?: string; userId?: string }>(view.private_metadata) ?? {};
  const values = view.state?.values ?? {};
  const field = (block: string) => values[block]?.v;

  const asana = await getAsanaAutomationToken();
  if (!asana) {
    const block = view.callback_id === "submit_comment" ? "comment" : "name";
    return errors({
      [block]: "Asana isn't linked. Open Connector → Slack and link Asana, then retry.",
    });
  }

  const install = await getSlackInstall();
  const botToken = install?.access_token;

  if (view.callback_id === "submit_comment") {
    const taskGid = field("task")?.selected_option?.value;
    const comment = field("comment")?.value?.trim();
    if (!taskGid) return errors({ task: "Pick a task." });
    if (!comment) return errors({ comment: "Add a comment." });

    await addComment(asana, taskGid, comment);
    await logAction({
      id: `${taskGid}:${Date.now()}`,
      type: "comment_added",
      at: Date.now(),
      by: meta.by ?? "Slack",
      summary: `Added a comment to a task: "${truncate(comment, 80)}"`,
    });
    if (botToken && meta.userId) {
      await slackApi(botToken, "chat.postMessage", {
        channel: meta.userId,
        text: `💬 Added your comment to the Asana task.`,
      }).catch(() => {});
    }
    return ok();
  }

  // create_asana_task
  const name = field("name")?.value?.trim();
  const assigneeGid = field("assignee")?.selected_option?.value || null;
  const dueOn = field("due")?.selected_date || null;
  const notes = field("notes")?.value ?? "";
  if (!name) return errors({ name: "Give the task a name." });

  const projectGid = await findProjectGid(asana, PINNED_PROJECT_NAME);
  const task = await createTask(asana, { name, notes, dueOn, projectGid, assignee: assigneeGid });

  const roster = await getRoster();
  const assigneeName = assigneeGid
    ? roster.find((r) => r.asanaGid === assigneeGid)?.asanaName
    : undefined;

  await logAction({
    id: task.gid,
    type: "task_created",
    at: Date.now(),
    by: meta.by ?? "Slack",
    summary:
      `Created “${name}”` +
      (assigneeName ? ` for ${assigneeName}` : "") +
      (dueOn ? ` (due ${dueOn})` : ""),
    taskName: name,
    taskUrl: task.url,
    assignee: assigneeName,
  });

  if (botToken && meta.userId) {
    await slackApi(botToken, "chat.postMessage", {
      channel: meta.userId,
      text:
        `✅ Created Asana task *${name}*` +
        (assigneeName ? ` for ${assigneeName}` : "") +
        (dueOn ? ` — due ${dueOn}` : "") +
        `\n${task.url}`,
    }).catch(() => {});
  }
  return ok();
}

// ---------------------------------------------------------------------------

interface SlackField {
  value?: string;
  selected_date?: string;
  selected_option?: { value: string };
}
interface SlackView {
  callback_id?: string;
  private_metadata?: string;
  state?: { values?: Record<string, Record<string, SlackField>> };
}
interface SlackPayload {
  type?: string;
  callback_id?: string;
  trigger_id?: string;
  user?: { id?: string; name?: string; username?: string };
  channel?: { id?: string };
  message?: { ts?: string; text?: string; user?: string };
  view?: SlackView;
}

function parsePayload(raw: string): SlackPayload | null {
  const params = new URLSearchParams(raw);
  const p = params.get("payload");
  return p ? safeJson<SlackPayload>(p) : null;
}

function safeJson<T>(s: string | undefined | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
