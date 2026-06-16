/**
 * Minimal Asana client: OAuth token exchange/refresh + a few read endpoints.
 * Docs: https://developers.asana.com/docs
 */

const API = "https://app.asana.com/api/1.0";
const AUTHORIZE = "https://app.asana.com/-/oauth_authorize";
const TOKEN = "https://app.asana.com/-/oauth_token";

export interface AsanaToken {
  access_token: string;
  refresh_token?: string;
  /** Absolute expiry time in ms. */
  expires_at: number;
}

export interface AsanaTask {
  gid: string;
  name: string;
  dueOn: string | null;
  url: string;
  projects: string[];
  completed: boolean;
  /** Task description — often holds the pasted Square form (incl. customer email). */
  notes: string;
  /** Section within Outgoing Activity, e.g. WHOLESALE / CATERING / SUBSCRIPTIONS. */
  section: string;
}

/**
 * Read-only granular scopes we request. These must also be enabled on the
 * Asana app (OAuth → "Specific scopes"). We never write, so reads only.
 */
const SCOPES = [
  "users:read",
  "projects:read",
  "tasks:read",
  "tasks:write", // create tasks from emails
].join(" ");

/** Build the URL we send the user to so they can authorize the app. */
export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_id", process.env.ASANA_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  u.searchParams.set("scope", SCOPES);
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  data?: { name?: string; email?: string };
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Asana token error: ${JSON.stringify(json)}`);
  return json as TokenResponse;
}

/** Exchange an authorization code for tokens (+ basic user info). */
export async function exchangeCode(code: string, redirectUri: string) {
  const r = await tokenRequest({
    grant_type: "authorization_code",
    client_id: process.env.ASANA_CLIENT_ID!,
    client_secret: process.env.ASANA_CLIENT_SECRET!,
    redirect_uri: redirectUri,
    code,
  });
  const token: AsanaToken = {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: Date.now() + r.expires_in * 1000,
  };
  return { token, user: r.data ?? {} };
}

/** Get a fresh access token from a refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<AsanaToken> {
  const r = await tokenRequest({
    grant_type: "refresh_token",
    client_id: process.env.ASANA_CLIENT_ID!,
    client_secret: process.env.ASANA_CLIENT_SECRET!,
    refresh_token: refreshToken,
  });
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token ?? refreshToken,
    expires_at: Date.now() + r.expires_in * 1000,
  };
}

async function apiGet(
  accessToken: string,
  path: string,
  params: Record<string, string> = {},
) {
  const u = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Asana API ${path} failed: ${JSON.stringify(json)}`);
  return json.data;
}

async function apiPost(accessToken: string, path: string, data: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Asana API ${path} failed: ${JSON.stringify(json)}`);
  return json.data;
}

/** The user's primary workspace gid. */
export async function getWorkspaceId(accessToken: string): Promise<string> {
  const me = await apiGet(accessToken, "/users/me", {
    opt_fields: "workspaces.name",
  });
  const ws = me.workspaces?.[0];
  if (!ws) throw new Error("No Asana workspace found for this user.");
  return ws.gid;
}

const TASK_FIELDS =
  "name,due_on,permalink_url,projects.name,completed,notes," +
  "memberships.project.name,memberships.section.name";

interface RawTask {
  gid: string;
  name: string;
  due_on: string | null;
  permalink_url: string;
  projects?: { name: string }[];
  completed?: boolean;
  notes?: string;
  memberships?: { project?: { name: string }; section?: { name: string } }[];
}

function sectionOf(t: RawTask): string {
  const mems = t.memberships ?? [];
  const pinned = mems.find((m) => m.project?.name === PINNED_PROJECT_NAME);
  return (pinned?.section?.name ?? mems[0]?.section?.name ?? "").trim();
}

function toTask(t: RawTask): AsanaTask {
  return {
    gid: t.gid,
    name: t.name,
    dueOn: t.due_on ?? null,
    url: t.permalink_url,
    projects: (t.projects ?? []).map((p) => p.name),
    completed: t.completed ?? false,
    notes: t.notes ?? "",
    section: sectionOf(t),
  };
}

/**
 * Tasks assigned to the current user. Incomplete only by default; pass
 * includeCompleted to also pull finished tasks (used for email matching).
 */
export async function getMyTasks(
  accessToken: string,
  opts: { dueOnly?: boolean; includeCompleted?: boolean } = {},
): Promise<AsanaTask[]> {
  const workspace = await getWorkspaceId(accessToken);
  const params: Record<string, string> = {
    assignee: "me",
    workspace,
    opt_fields: TASK_FIELDS,
    limit: "100",
  };
  if (!opts.includeCompleted) params.completed_since = "now";

  const data: RawTask[] = await apiGet(accessToken, "/tasks", params);
  let tasks = data.map(toTask);
  if (opts.dueOnly) {
    tasks = tasks
      .filter((t) => t.dueOn)
      .sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : 1));
  }
  return tasks;
}

/** Tasks in a specific project. Incomplete only unless includeCompleted. */
export async function getProjectTasks(
  accessToken: string,
  projectId: string,
  opts: { includeCompleted?: boolean } = {},
): Promise<AsanaTask[]> {
  const params: Record<string, string> = {
    opt_fields: TASK_FIELDS,
    limit: "100",
  };
  if (!opts.includeCompleted) params.completed_since = "now";

  const data: RawTask[] = await apiGet(
    accessToken,
    `/projects/${projectId}/tasks`,
    params,
  );
  return data.map(toTask);
}

/** Tasks in the project matching this name (case-insensitive). */
export async function getProjectTasksByName(
  accessToken: string,
  name: string,
  opts: { includeCompleted?: boolean } = {},
): Promise<AsanaTask[]> {
  const projects = await listProjects(accessToken);
  const match = projects.find(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (!match) throw new Error(`No Asana project named "${name}" found.`);
  return getProjectTasks(accessToken, match.gid, opts);
}

/** The project pinned in the UI and used as a match candidate pool. */
export const PINNED_PROJECT_NAME = "Outgoing Activity";

export interface AsanaProject {
  gid: string;
  name: string;
}

/** Resolve a project gid by name (case-insensitive). */
export async function findProjectGid(
  accessToken: string,
  name: string,
): Promise<string> {
  const projects = await listProjects(accessToken);
  const match = projects.find(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (!match) throw new Error(`No Asana project named "${name}" found.`);
  return match.gid;
}

/** Sections within a project (the order categories). */
export async function listSections(
  accessToken: string,
  projectGid: string,
): Promise<AsanaProject[]> {
  const data = await apiGet(accessToken, `/projects/${projectGid}/sections`, {
    opt_fields: "name",
  });
  return (data as AsanaProject[]).map((s) => ({ gid: s.gid, name: s.name }));
}

export interface NewTask {
  name: string;
  notes: string;
  dueOn?: string | null;
  projectGid: string;
  sectionGid?: string | null;
}

/** Create a task in a project, optionally placed in a section. */
export async function createTask(
  accessToken: string,
  t: NewTask,
): Promise<{ gid: string; name: string; url: string }> {
  const created = await apiPost(accessToken, "/tasks?opt_fields=permalink_url,name", {
    name: t.name,
    notes: t.notes,
    projects: [t.projectGid],
    ...(t.dueOn ? { due_on: t.dueOn } : {}),
  });
  if (t.sectionGid) {
    await apiPost(accessToken, `/sections/${t.sectionGid}/addTask`, {
      task: created.gid,
    });
  }
  return { gid: created.gid, name: created.name, url: created.permalink_url };
}

/** Add a comment (story) to an existing task. */
export async function addComment(
  accessToken: string,
  taskGid: string,
  text: string,
): Promise<void> {
  await apiPost(accessToken, `/tasks/${taskGid}/stories`, { text });
}

/** Non-archived projects in the user's workspace (for the picker). */
export async function listProjects(accessToken: string): Promise<AsanaProject[]> {
  const workspace = await getWorkspaceId(accessToken);
  const data = await apiGet(accessToken, "/projects", {
    workspace,
    archived: "false",
    opt_fields: "name",
    limit: "100",
  });
  return (data as AsanaProject[]).map((p) => ({ gid: p.gid, name: p.name }));
}
