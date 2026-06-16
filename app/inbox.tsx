"use client";

import { useState } from "react";

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export default function Inbox() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<GmailMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url = query.trim()
        ? `/api/gmail/search?q=${encodeURIComponent(query.trim())}`
        : "/api/gmail/search";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setMessages(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          Catering &amp; wholesale inquiries
        </h2>
        <p className="mt-1 text-sm text-muted">
          Search your inbox. Leave it empty for the default catering/wholesale
          filter, or type a Gmail search like{" "}
          <code className="rounded bg-cream px-1.5 py-0.5 text-xs text-ink">
            from:square
          </code>
          .
        </p>
      </div>

      <form onSubmit={runSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search inquiries…"
          className="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted focus:border-brand"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-cream transition hover:bg-brand-hover disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {messages !== null && (
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {messages.length} result{messages.length === 1 ? "" : "s"}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {messages?.length === 0 && (
          <li className="rounded-xl border border-line bg-surface px-4 py-10 text-center text-sm text-muted">
            No matching messages.
          </li>
        )}
        {messages?.map((m) => (
          <li
            key={m.id}
            className="rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-accent/60 hover:shadow-sm"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-semibold text-ink">
                {m.subject || "(no subject)"}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {formatDate(m.date)}
              </span>
            </div>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {cleanFrom(m.from)}
            </span>
            <span className="mt-1.5 block line-clamp-2 text-sm text-ink/70">
              {m.snippet}
            </span>
          </li>
        ))}
      </ul>

      {messages === null && !error && (
        <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-muted">
          Run a search to see catering &amp; wholesale inquiries here.
        </div>
      )}
    </section>
  );
}

/** "Jane Doe <jane@x.com>" -> "Jane Doe" when a display name is present. */
function cleanFrom(from: string): string {
  const match = from.match(/^\s*"?([^"<]+?)"?\s*<.+>\s*$/);
  return match ? match[1].trim() : from;
}

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
