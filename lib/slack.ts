/**
 * Minimal Slack client: OAuth v2 install, Web API calls, request-signature
 * verification, and Block Kit modal builders for the two message shortcuts
 * (create task / add comment). Plain fetch + node crypto, no SDK.
 * Docs: https://api.slack.com/
 */

import crypto from "crypto";

const AUTHORIZE = "https://slack.com/oauth/v2/authorize";
const TOKEN = "https://slack.com/api/oauth.v2.access";
const API = "https://slack.com/api";

/**
 * Bot scopes. `commands` powers the message shortcuts + slash command,
 * `chat:write` posts confirmations, and the user scopes let us match Slack
 * people to Asana users by email when building the roster.
 */
const SCOPES = ["commands", "chat:write", "users:read", "users:read.email"].join(",");

/** Build the URL we send the admin to so they can install the app. */
export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_id", process.env.SLACK_CLIENT_ID!);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

interface OAuthResponse {
  ok: boolean;
  error?: string;
  access_token: string; // bot token (xoxb-)
  bot_user_id?: string;
  team?: { id: string; name?: string };
  authed_user?: { id: string };
}

/** Exchange the OAuth code for a bot token + team info. */
export async function exchangeCode(code: string, redirectUri: string): Promise<OAuthResponse> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const json = (await res.json()) as OAuthResponse;
  if (!json.ok) throw new Error(`Slack oauth error: ${json.error ?? "unknown"}`);
  return json;
}

/** Call a Slack Web API method with a bot token. Throws on `ok: false`. */
export async function slackApi<T = Record<string, unknown>>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method} error: ${json.error ?? "unknown"}`);
  return json as T;
}

/**
 * Verify a Slack request signature against the raw body.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackRequest(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export interface SlackUser {
  id: string;
  name: string;
  email?: string;
}

/** Active, non-bot members of the workspace (for the roster picker). */
export async function listSlackUsers(token: string): Promise<SlackUser[]> {
  const json = await slackApi<{ members?: RawMember[] }>(token, "users.list", {
    limit: 200,
  });
  return (json.members ?? [])
    .filter((m) => !m.deleted && !m.is_bot && m.id !== "USLACKBOT")
    .map((m) => ({
      id: m.id,
      name: m.profile?.real_name || m.real_name || m.name || m.id,
      email: m.profile?.email,
    }));
}

interface RawMember {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { real_name?: string; email?: string };
}

// ---------------------------------------------------------------------------
// Natural-language helpers (heuristic, matching lib/parse.ts's no-LLM style)
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Guess a due date (YYYY-MM-DD) from phrases like "tonight", "tomorrow",
 * "by Friday", "in 3 days", "next week". Returns null if nothing matches —
 * the modal lets the user pick a date either way.
 */
export function parseDueDate(text: string): string | null {
  const t = (text || "").toLowerCase();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const add = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };

  if (/\b(today|tonight|eod|end of day|this evening|asap)\b/.test(t)) return ymd(today);
  if (/\btomorrow\b/.test(t)) return add(1);
  if (/\bnext week\b/.test(t)) return add(7);
  const inDays = t.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) return add(parseInt(inDays[1], 10));

  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
      let delta = (i - today.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // "monday" means next monday, not today
      return add(delta);
    }
  }
  return null;
}

/** Slack user ids @-mentioned in a message, e.g. <@U123> / <@W123>. */
export function extractMentions(text: string): string[] {
  const ids: string[] = [];
  const re = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ""))) ids.push(m[1]);
  return ids;
}

/** Turn a message into a task name: first line, mentions stripped, trimmed. */
export function deriveTaskName(text: string): string {
  const firstLine = (text || "").split(/\r?\n/)[0] ?? "";
  const clean = firstLine
    .replace(/<@[UW][A-Z0-9]+(?:\|[^>]*)?>/g, "")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2") // <url|label> -> label
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 120) || "Task from Slack";
}

// ---------------------------------------------------------------------------
// Block Kit modal builders
// ---------------------------------------------------------------------------

interface Option {
  text: { type: "plain_text"; text: string };
  value: string;
}

export function optionFor(label: string, value: string): Option {
  return { text: { type: "plain_text", text: label.slice(0, 75) || "—" }, value };
}

export function buildCreateTaskModal(opts: {
  taskName: string;
  notesDefault: string;
  dueDefault: string | null;
  assigneeOptions: Option[];
  initialAssignee: Option | null;
  privateMetadata: string;
}) {
  const assigneeBlock: Record<string, unknown> = {
    type: "input",
    block_id: "assignee",
    optional: true,
    label: { type: "plain_text", text: "Assignee" },
    element: {
      type: "static_select",
      action_id: "v",
      placeholder: { type: "plain_text", text: "Unassigned" },
      options: opts.assigneeOptions,
      ...(opts.initialAssignee ? { initial_option: opts.initialAssignee } : {}),
    },
  };
  // A select with zero options is invalid; drop the block if the roster is empty.
  const blocks: Record<string, unknown>[] = [
    {
      type: "input",
      block_id: "name",
      label: { type: "plain_text", text: "Task name" },
      element: {
        type: "plain_text_input",
        action_id: "v",
        initial_value: opts.taskName,
      },
    },
  ];
  if (opts.assigneeOptions.length > 0) blocks.push(assigneeBlock);
  blocks.push(
    {
      type: "input",
      block_id: "due",
      optional: true,
      label: { type: "plain_text", text: "Due date" },
      element: {
        type: "datepicker",
        action_id: "v",
        ...(opts.dueDefault ? { initial_date: opts.dueDefault } : {}),
      },
    },
    {
      type: "input",
      block_id: "notes",
      optional: true,
      label: { type: "plain_text", text: "Notes" },
      element: {
        type: "plain_text_input",
        action_id: "v",
        multiline: true,
        initial_value: opts.notesDefault,
      },
    },
  );
  return {
    type: "modal",
    callback_id: "submit_create_task",
    private_metadata: opts.privateMetadata,
    title: { type: "plain_text", text: "New Asana task" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

export function buildCommentModal(opts: {
  taskOptions: Option[];
  commentDefault: string;
  privateMetadata: string;
}) {
  return {
    type: "modal",
    callback_id: "submit_comment",
    private_metadata: opts.privateMetadata,
    title: { type: "plain_text", text: "Comment on task" },
    submit: { type: "plain_text", text: "Add comment" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "task",
        label: { type: "plain_text", text: "Asana task" },
        element: {
          type: "static_select",
          action_id: "v",
          placeholder: { type: "plain_text", text: "Pick a task" },
          options: opts.taskOptions,
        },
      },
      {
        type: "input",
        block_id: "comment",
        label: { type: "plain_text", text: "Comment" },
        element: {
          type: "plain_text_input",
          action_id: "v",
          multiline: true,
          initial_value: opts.commentDefault,
        },
      },
    ],
  };
}
