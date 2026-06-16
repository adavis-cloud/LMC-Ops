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

export interface GmailFullMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  labelIds: string[];
}

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
}

function decode(data?: string): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function findPart(payload: Part, mime: string): Part | null {
  if (payload.mimeType === mime && payload.body?.data) return payload;
  for (const p of payload.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBody(payload: Part): string {
  const plain = findPart(payload, "text/plain");
  if (plain) return decode(plain.body!.data).trim();
  const html = findPart(payload, "text/html");
  if (html) return stripHtml(decode(html.body!.data));
  return decode(payload.body?.data).trim();
}

/** Fetch one message in full, including the decoded text body. */
export async function getMessage(
  accessToken: string,
  id: string,
): Promise<GmailFullMessage> {
  const url = new URL(`${GMAIL_BASE}/messages/${id}`);
  url.searchParams.set("format", "full");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Gmail get message failed (${res.status})`);
  }

  const data = await res.json();
  const headers = data.payload?.headers as
    | { name: string; value: string }[]
    | undefined;

  return {
    id,
    threadId: data.threadId,
    from: header(headers, "From"),
    to: header(headers, "To"),
    subject: header(headers, "Subject"),
    date: header(headers, "Date"),
    body: extractBody(data.payload ?? {}),
    labelIds: (data.labelIds ?? []) as string[],
  };
}

/**
 * Thrown when Gmail rejects a write because the OAuth token is missing the
 * `gmail.modify` scope (e.g. the user consented under an older read-only grant).
 * The fix is always re-consent, so the UI treats this specially.
 */
export class GmailScopeError extends Error {
  constructor(
    message = "Google permission is insufficient — reconnect your Google account.",
  ) {
    super(message);
    this.name = "GmailScopeError";
  }
}

/** Google flags a missing-scope rejection with a specific 403 reason string. */
function isScopeError(status: number, body: string): boolean {
  return (
    status === 403 &&
    /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient authentication scopes/i.test(
      body,
    )
  );
}

/** Add/remove Gmail system labels on a message (e.g. mark read, star). */
export async function modifyLabels(
  accessToken: string,
  id: string,
  changes: { add?: string[]; remove?: string[] },
): Promise<string[]> {
  const res = await fetch(`${GMAIL_BASE}/messages/${id}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      addLabelIds: changes.add ?? [],
      removeLabelIds: changes.remove ?? [],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (isScopeError(res.status, text)) throw new GmailScopeError();
    throw new Error(`Gmail modify failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return (data.labelIds ?? []) as string[];
}

/**
 * Send a plain-text email. The recipient is ALWAYS the signed-in user — the
 * caller passes `self` and we refuse anything else, so this can never email a
 * customer. (See the "no accidental sends" guarantee.)
 */
export async function sendSelfEmail(
  accessToken: string,
  self: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  if (to.trim().toLowerCase() !== self.trim().toLowerCase()) {
    throw new Error("Refusing to send: recipient is not the signed-in user.");
  }

  const mime = [
    `To: ${self}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
    "",
    body,
  ].join("\r\n");
  const raw = Buffer.from(mime, "utf8").toString("base64url");

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (isScopeError(res.status, text)) throw new GmailScopeError();
    throw new Error(`Gmail send failed (${res.status}): ${text}`);
  }
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
