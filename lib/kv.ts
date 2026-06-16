/**
 * Tiny Upstash Redis (REST) client — one fetch per command, no SDK.
 * Mirrors the "minimal fetch client" style of lib/asana.ts.
 *
 * Configure with KV_REST_API_URL + KV_REST_API_TOKEN (the standard names
 * Upstash and Vercel KV both expose). When unset, kvConfigured() is false and
 * callers can degrade gracefully instead of throwing.
 */

const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

/** True when a KV backend is configured. */
export function kvConfigured(): boolean {
  return Boolean(BASE && TOKEN);
}

async function command<T = unknown>(args: (string | number)[]): Promise<T> {
  if (!BASE || !TOKEN) {
    throw new Error("KV not configured (set KV_REST_API_URL and KV_REST_API_TOKEN).");
  }
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || json?.error) {
    throw new Error(`KV ${args[0]} failed: ${JSON.stringify(json?.error ?? json)}`);
  }
  return json.result as T;
}

export async function kvGetJSON<T>(key: string): Promise<T | null> {
  const raw = await command<string | null>(["GET", key]);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJSON(key: string, value: unknown): Promise<void> {
  await command(["SET", key, JSON.stringify(value)]);
}

export async function kvDel(key: string): Promise<void> {
  await command(["DEL", key]);
}

/** Push onto the head of a list and trim it to `cap` items (newest first). */
export async function kvLogPush(key: string, value: unknown, cap = 50): Promise<void> {
  await command(["LPUSH", key, JSON.stringify(value)]);
  await command(["LTRIM", key, 0, cap - 1]);
}

/** Read a list (newest first), parsing each JSON entry. */
export async function kvLogList<T>(key: string, count = 50): Promise<T[]> {
  const raw = await command<string[]>(["LRANGE", key, 0, count - 1]);
  return (raw ?? [])
    .map((s) => {
      try {
        return JSON.parse(s) as T;
      } catch {
        return null;
      }
    })
    .filter((x): x is T => x !== null);
}
