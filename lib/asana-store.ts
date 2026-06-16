/**
 * Asana token for *background automation* (Slack shortcuts), kept in KV so it's
 * reachable without a browser cookie. The web app still uses the cookie
 * (lib/asana-session.ts); that path mirrors the token here on read/refresh so
 * connecting Asana once in the UI is enough to power Slack-triggered actions.
 */

import { AsanaToken, refreshAccessToken } from "./asana";
import { kvGetJSON, kvSetJSON, kvConfigured } from "./kv";

const K_TOKEN = "asana:token";

export const setAsanaTokenKV = (t: AsanaToken) => kvSetJSON(K_TOKEN, t);

/** True once an Asana token has been mirrored to KV (automation is linked). */
export async function isAsanaAutomationLinked(): Promise<boolean> {
  if (!kvConfigured()) return false;
  return (await kvGetJSON<AsanaToken>(K_TOKEN)) !== null;
}

/** Best-effort mirror from the cookie path; never throws (KV is optional). */
export async function mirrorAsanaToken(t: AsanaToken): Promise<void> {
  if (!kvConfigured()) return;
  try {
    await kvSetJSON(K_TOKEN, t);
  } catch {
    /* KV mirror is best-effort */
  }
}

/**
 * A valid Asana access token for background use, from KV. Refreshes and
 * re-persists if expired. Returns null if not linked / refresh failed.
 */
export async function getAsanaAutomationToken(): Promise<string | null> {
  if (!kvConfigured()) return null;
  const token = await kvGetJSON<AsanaToken>(K_TOKEN);
  if (!token) return null;

  if (Date.now() < token.expires_at - 60_000) return token.access_token;

  if (!token.refresh_token) return null;
  try {
    const refreshed = await refreshAccessToken(token.refresh_token);
    await kvSetJSON(K_TOKEN, refreshed);
    return refreshed.access_token;
  } catch {
    return null;
  }
}
