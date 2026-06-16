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

interface TaskRef {
  gid: string;
  name: string;
  url: string;
  completed: boolean;
}
interface AsanaMatch {
  connected: boolean;
  confidence?: "high" | "medium" | "low" | "none";
  match?: TaskRef;
  alternates?: TaskRef[];
}
interface MessageDetail {
  message: {
    id: string;
    from: string;
    to: string;
    subject: string;
    date: string;
    body: string;
  };
  asana: AsanaMatch;
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

  // Detail view
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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
    load(
      query.trim()
        ? `/api/gmail/search?q=${encodeURIComponent(query.trim())}`
        : "/api/gmail/search",
    );
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

  async function openMessage(id: string) {
    setOpenId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/gmail/message/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't open message");
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Couldn't open message");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setOpenId(null);
    setDetail(null);
    setDetailError(null);
  }

  // ---- Detail view ----
  if (openId) {
    return (
      <section className="flex flex-col gap-4">
        <button
          type="button"
          onClick={closeDetail}
          className="w-fit text-sm font-medium text-brand hover:underline"
        >
          ← Back to results
        </button>

        {detailLoading && <p className="text-sm text-muted">Loading email…</p>}
        {detailError && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {detailError}
          </p>
        )}

        {detail && (
          <>
            <div className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-lg font-semibold text-ink">
                {detail.message.subject || "(no subject)"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                <span className="text-ink">{cleanFrom(detail.message.from)}</span>
                {" · "}
                {formatDate(detail.message.date)}
              </p>
            </div>

            <AsanaMatchBlock asana={detail.asana} />

            <div className="rounded-xl border border-line bg-surface p-5">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink/80">
                {detail.message.body || "(no message body)"}
              </pre>
            </div>
          </>
        )}
      </section>
    );
  }

  // ---- List view ----
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">
          Inbox inquiries
        </h2>
        <p className="mt-1 text-sm text-muted">
          Filter by type, search, or show everything. Click an email to read it
          and check Asana for a matching task.
        </p>
      </div>

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
          {active === "urgent" && messages.length > 0 ? " · ranked by urgency" : ""}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {messages?.length === 0 && (
          <li className="rounded-xl border border-line bg-surface px-4 py-10 text-center text-sm text-muted">
            No matching messages.
          </li>
        )}
        {messages?.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => openMessage(m.id)}
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-accent/60 hover:shadow-sm"
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
            </button>
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

/** Asana match panel — styled by how confident the match is. */
function AsanaMatchBlock({ asana }: { asana: AsanaMatch }) {
  if (!asana.connected) {
    return (
      <div className="rounded-xl border border-line bg-cream px-4 py-3 text-sm text-muted">
        <a href="/api/asana/connect" className="font-medium text-brand hover:underline">
          Connect Asana
        </a>{" "}
        to check for a matching task.
      </div>
    );
  }

  const conf = asana.confidence ?? "none";

  if (conf === "none" || !asana.match) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        No matching Asana task found.
      </div>
    );
  }

  const styles: Record<string, { box: string; label: string; tag: string }> = {
    high: {
      box: "border-green-300 bg-green-50",
      label: "✓ Matching task in Asana",
      tag: "text-green-700",
    },
    medium: {
      box: "border-amber-300 bg-amber-50",
      label: "Likely match — worth verifying",
      tag: "text-amber-700",
    },
    low: {
      box: "border-line bg-cream",
      label: "Possible match (low confidence)",
      tag: "text-muted",
    },
  };
  const s = styles[conf];

  return (
    <div className={`rounded-xl border px-4 py-3 ${s.box}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${s.tag}`}>
        {s.label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <a
          href={asana.match.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-ink hover:underline"
        >
          {asana.match.name}
        </a>
        {asana.match.completed && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
            Done
          </span>
        )}
      </div>
      {asana.alternates && asana.alternates.length > 0 && (
        <div className="mt-2 border-t border-line/70 pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Other possibilities
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {asana.alternates.map((a) => (
              <li key={a.gid}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-ink/70 hover:underline"
                >
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Jane Doe <jane@x.com>" -> "Jane Doe"; strips Square's "via orders" relay. */
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
