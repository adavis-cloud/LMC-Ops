import { cookies } from "next/headers";
import { AsanaToken, refreshAccessToken } from "./asana";
import { mirrorAsanaToken } from "./asana-store";

const COOKIE = "asana_session";

/** Persist the Asana token in an httpOnly cookie (and mirror it to KV). */
export async function writeAsanaToken(token: AsanaToken) {
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60 days (refresh token lifetime headroom)
  });
  // Mirror to KV so Slack-triggered automation can use it without a cookie.
  await mirrorAsanaToken(token);
}

export async function clearAsanaToken() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function readAsanaToken(): Promise<AsanaToken | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AsanaToken;
  } catch {
    return null;
  }
}

/** True if the user has connected Asana. */
export async function isAsanaConnected(): Promise<boolean> {
  return (await readAsanaToken()) !== null;
}

/**
 * Return a valid access token, refreshing (and re-persisting) if it's expired
 * or within 60s of expiry. Returns null if not connected / refresh failed.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const token = await readAsanaToken();
  if (!token) return null;

  if (Date.now() < token.expires_at - 60_000) {
    // Keep the KV mirror fresh for background automation.
    await mirrorAsanaToken(token);
    return token.access_token;
  }

  if (!token.refresh_token) return null;
  try {
    const refreshed = await refreshAccessToken(token.refresh_token);
    await writeAsanaToken(refreshed);
    return refreshed.access_token;
  } catch {
    return null;
  }
}
