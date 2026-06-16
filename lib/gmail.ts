/**
 * Minimal Gmail REST client (read-only).
 * Uses the user's OAuth access token; no extra SDK dependency.
 * Docs: https://developers.google.com/gmail/api/reference/rest
 */

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  /** Gmail system labels, e.g. UNREAD, IMPORTANT, STARRED. */
  labelIds: string[];
}

interface ListResponse {
  messages?: { id: string; threadId: string }[];
  resultSizeEstimate?: number;
}

function header(
  headers: { name: string; value: string }[] | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

/**
 * Search the inbox and return lightweight message metadata.
 * @param accessToken Google OAuth access token
 * @param query Gmail search query (same syntax as the Gmail search box)
 * @param maxResults Cap on number of messages to return (default 25)
 */
export async function searchMessages(
  accessToken: string,
  query: string,
  maxResults = 25,
): Promise<GmailMessage[]> {
  const listUrl = new URL(`${GMAIL_BASE}/messages`);
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(maxResults));

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Gmail list failed (${listRes.status}): ${body}`);
  }

  const list = (await listRes.json()) as ListResponse;
  const ids = list.messages ?? [];

  // Fetch metadata for each message in parallel (headers + snippet only).
  const messages = await Promise.all(
    ids.map(async ({ id, threadId }) => {
      const msgUrl = new URL(`${GMAIL_BASE}/messages/${id}`);
      msgUrl.searchParams.set("format", "metadata");
      for (const h of ["From", "Subject", "Date"]) {
        msgUrl.searchParams.append("metadataHeaders", h);
      }

      const res = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!res.ok) return null;

      const data = await res.json();
      const headers = data.payload?.headers as
        | { name: string; value: string }[]
        | undefined;

      return {
        id,
        threadId,
        from: header(headers, "From"),
        subject: header(headers, "Subject"),
        date: header(headers, "Date"),
        snippet: (data.snippet ?? "") as string,
        labelIds: (data.labelIds ?? []) as string[],
      } satisfies GmailMessage;
    }),
  );

  return messages.filter((m): m is GmailMessage => m !== null);
}
