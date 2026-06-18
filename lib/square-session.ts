import { cookies } from "next/headers";
import { SquareToken, refreshAccessToken } from "./square";

const COOKIE = "square_session";

/** Persist the Square token in an httpOnly cookie. */
export async function writeSquareToken(token: SquareToken) {
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 80, // 80 days (Square refresh tokens last ~90)
  });
}

export async function clearSquareToken() {
  (await cookies()).delete(COOKIE);
}

export async function readSquareToken(): Promise<SquareToken | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SquareToken;
  } catch {
    return null;
  }
}

/** True if Square OAuth credentials are configured in the environment. */
export function isSquareConfigured(): boolean {
  return Boolean(process.env.SQUARE_CLIENT_ID && process.env.SQUARE_CLIENT_SECRET);
}

export async function isSquareConnected(): Promise<boolean> {
  return (await readSquareToken()) !== null;
}

/**
 * A valid access token, refreshing (and re-persisting) within 60s of expiry.
 * Returns null if not connected / refresh failed.
 */
export async function getValidSquareToken(): Promise<string | null> {
  const token = await readSquareToken();
  if (!token) return null;
  if (Date.now() < token.expires_at - 60_000) return token.access_token;
  if (!token.refresh_token) return null;
  try {
    const refreshed = await refreshAccessToken(token.refresh_token);
    await writeSquareToken(refreshed);
    return refreshed.access_token;
  } catch {
    return null;
  }
}
