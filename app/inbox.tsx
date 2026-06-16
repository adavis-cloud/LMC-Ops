"use client";

import { useState } from "react";

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  reasons?: string[];
}

const FILTERS = [
  { key: "catering", label: "Catering" },
  { key: "wholesale", label: "Wholesale" },
  { key: "square", label: "Square forms" },
  { key: "bill", label: "Bills" },
  { key: "urgent", label: "Urgent" },
] as const;

export default function Inbox() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<GmailMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  async function load(url: string) {
    setLoading(true);
    setError(null);
    try {
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

  function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setActive(null);
    const url = query.trim()
      ? `/api/gmail/search?q=${encodeURIComponent(query.trim())}`
      : "/api/gmail/search";
    load(url);
  }

  function showAll() {
    setQuery("");
    setActive(null);
    load("/api/gmail/search?all=1");
  }

  function runFilter(key: string) {
    setQuery("");
    setActive(key);
    load(`/api/gmail/search?filter=${key}`);
  }

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          Inbox inquiries
        </h2>
        <p className="mt-1 text-sm text-muted">
          Filter by type, search your inbox, or show everything. Urgent is
          ranked most-pressing first.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => runFilter(f.key)}
            disabled={loading}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              active === f.key
                ? "border-brand bg-brand text-cream"
                : "border-line bg-surface text-ink hover:bg-cream"
            }`}
          >
            {f.label}
          </button>
        ))}
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
        <button
          type="button"
          onClick={showAll}
          disabled={loading}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-cream disabled:opacity-50"
        >
          Show all
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
          {active === "urgent" && messages.length > 0
            ? " · ranked by urgency"
            : ""}
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
            {m.reasons && m.reasons.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.reasons.slice(0, 4).map((r) => (
                  <span
                    key={r}
                    className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-brand"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
            <span className="mt-1.5 block line-clamp-2 text-sm text-ink/70">
              {m.snippet}
            </span>
          </li>
        ))}
      </ul>

      {messages === null && !error && (
        <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-muted">
          Pick a filter above, or search, to see inquiries here.
        </div>
      )}
    </section>
  );
}

/**
 * "Jane Doe <jane@x.com>" -> "Jane Doe" when a display name is present.
 * Also strips Square's relay suffix so a form entry shows the customer, e.g.
 * "danny@x.com via orders <orders@lastmile.cafe>" -> "danny@x.com".
 */
function cleanFrom(from: string): string {
  const match = from.match(/^\s*"?([^"<]+?)"?\s*<.+>\s*$/);
  const name = match ? match[1].trim() : from;
  return name.replace(/\s+via\s+\S+$/i, "").trim();
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
