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
  const [usedQuery, setUsedQuery] = useState<string>("");

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
      setUsedQuery(data.query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setMessages(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium">Catering &amp; wholesale inquiries</h2>
        <p className="text-sm text-gray-500">
          Searches your inbox. Leave the box empty to use the default
          catering/wholesale filter, or type a Gmail search (e.g.{" "}
          <code className="rounded bg-gray-100 px-1">from:square</code>).
        </p>
      </div>

      <form onSubmit={runSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Default: catering OR wholesale OR contact form…"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {messages && (
        <p className="text-xs text-gray-400">
          {messages.length} result{messages.length === 1 ? "" : "s"} ·{" "}
          <code>{usedQuery}</code>
        </p>
      )}

      <ul className="flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200">
        {messages?.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-gray-400">
            No matching messages.
          </li>
        )}
        {messages?.map((m) => (
          <li key={m.id} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium">
                {m.subject || "(no subject)"}
              </span>
              <span className="shrink-0 text-xs text-gray-400">
                {formatDate(m.date)}
              </span>
            </div>
            <span className="truncate text-xs text-gray-500">{m.from}</span>
            <span className="line-clamp-2 text-xs text-gray-400">
              {m.snippet}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
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
