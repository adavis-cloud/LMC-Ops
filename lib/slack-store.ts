/**
 * Durable Slack state in KV (Upstash). Unlike the cookie-backed Asana/Google
 * tokens, these must be readable from background webhooks (Slack shortcuts),
 * which carry no browser session — so they live in KV, not cookies.
 */

import { kvGetJSON, kvSetJSON, kvDel, kvLogPush, kvLogList } from "./kv";

/** The workspace install — a bot token (xoxb-) plus identifying ids. */
export interface SlackInstall {
  access_token: string;
  team_id: string;
  team_name?: string;
  bot_user_id?: string;
  authed_user_id?: string;
  installed_at: number;
}

/** One Slack person mapped to one Asana user, so we can assign tasks. */
export interface RosterEntry {
  slackUserId: string;
  slackName: string;
  asanaGid: string;
  asanaName: string;
}

/** A thing the bot did, surfaced in the web app's Slack activity feed. */
export interface ActionLogEntry {
  id: string;
  type: "task_created" | "comment_added";
  at: number;
  by: string;
  summary: string;
  taskName?: string;
  taskUrl?: string;
  assignee?: string;
  channel?: string;
  slackPermalink?: string;
}

const K_INSTALL = "slack:install";
const K_ROSTER = "slack:roster";
const K_LOG = "slack:actions";

export const getSlackInstall = () => kvGetJSON<SlackInstall>(K_INSTALL);
export const setSlackInstall = (v: SlackInstall) => kvSetJSON(K_INSTALL, v);
export const clearSlackInstall = () => kvDel(K_INSTALL);

export const getRoster = async (): Promise<RosterEntry[]> =>
  (await kvGetJSON<RosterEntry[]>(K_ROSTER)) ?? [];
export const setRoster = (v: RosterEntry[]) => kvSetJSON(K_ROSTER, v);

export const logAction = (e: ActionLogEntry) => kvLogPush(K_LOG, e, 50);
export const recentActions = () => kvLogList<ActionLogEntry>(K_LOG, 50);
