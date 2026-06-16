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
}

/** Build the URL we send the user to so they can authorize the app. */
export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(AUTHORIZE);
  u.searchParams.set("client_id", process.env.ASANA_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
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

/** The user's primary workspace gid. */
export async function getWorkspaceId(accessToken: string): Promise<string> {
  const me = await apiGet(accessToken, "/users/me", {
    opt_fields: "workspaces.name",
  });
  const ws = me.workspaces?.[0];
  if (!ws) throw new Error("No Asana workspace found for this user.");
  return ws.gid;
}

const TASK_FIELDS = "name,due_on,permalink_url,projects.name";

interface RawTask {
  gid: string;
  name: string;
  due_on: string | null;
  permalink_url: string;
  projects?: { name: string }[];
}

function toTask(t: RawTask): AsanaTask {
  return {
    gid: t.gid,
    name: t.name,
    dueOn: t.due_on ?? null,
    url: t.permalink_url,
    projects: (t.projects ?? []).map((p) => p.name),
  };
}

/** Incomplete tasks assigned to the current user. */
export async function getMyTasks(
  accessToken: string,
  opts: { dueOnly?: boolean } = {},
): Promise<AsanaTask[]> {
  const workspace = await getWorkspaceId(accessToken);
  const data: RawTask[] = await apiGet(accessToken, "/tasks", {
    assignee: "me",
    workspace,
    completed_since: "now", // returns only incomplete tasks
    opt_fields: TASK_FIELDS,
    limit: "100",
  });
  let tasks = data.map(toTask);
  if (opts.dueOnly) {
    tasks = tasks
      .filter((t) => t.dueOn)
      .sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : 1));
  }
  return tasks;
}

/** Incomplete tasks in a specific project. */
export async function getProjectTasks(
  accessToken: string,
  projectId: string,
): Promise<AsanaTask[]> {
  const data: RawTask[] = await apiGet(
    accessToken,
    `/projects/${projectId}/tasks`,
    { completed_since: "now", opt_fields: TASK_FIELDS, limit: "100" },
  );
  return data.map(toTask);
}

export interface AsanaProject {
  gid: string;
  name: string;
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
