"use client";

import { useEffect, useState } from "react";

interface LearnedEntry {
  key: string;
  scope: "email" | "domain" | "org name";
  label: string;
  verdict: "confirm" | "reject";
  tasks: { gid: string; name: string }[];
  section?: string;
}

const SCOPE_LABEL: Record<LearnedEntry["scope"], string> = {
  email: "Customer",
  domain: "Organization",
  "org name": "Mentions",
};

export default function Learned() {
  const [entries, setEntries] = useState<LearnedEntry[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/asana/learnings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setConfigured(data.configured);
      setEntries(data.learned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function forget(entry: LearnedEntry, gid?: string) {
    setBusy(gid ?? entry.key);
    try {
      await fetch("/api/asana/learnings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entry.key, verdict: entry.verdict, gid }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">{error}</p>;
  }
  if (!configured) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">Learning isn’t persisting</p>
        <p className="mt-0.5 text-amber-700">
          KV isn’t configured, so corrections work in the moment but aren’t saved.
          Set <code>KV_REST_API_URL</code> and <code>KV_REST_API_TOKEN</code> in the
          deployment to turn this on.
        </p>
      </div>
    );
  }
  if (entries === null) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
        Nothing learned yet. Use <span className="font-medium">✓ Correct</span> or{" "}
        <span className="font-medium">✗ Not the right task</span> on a match and it’ll show up here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((e) => (
        <li
          key={`${e.verdict}:${e.key}`}
          className="rounded-xl border border-line bg-surface px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-brand">
              {SCOPE_LABEL[e.scope]}
            </span>
            <span className="text-sm font-medium text-ink">{e.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                e.verdict === "confirm"
                  ? "bg-green-100 text-green-700"
                  : "bg-cream text-muted"
              }`}
            >
              {e.verdict === "confirm" ? "always suggest" : "never suggest"}
            </span>
            {e.section && (
              <span className="text-[11px] uppercase tracking-wide text-muted">
                {e.section}
              </span>
            )}
            <button
              type="button"
              onClick={() => forget(e)}
              disabled={busy === e.key}
              className="ml-auto text-xs text-muted underline-offset-2 hover:underline disabled:opacity-50"
            >
              Forget all
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {e.tasks.map((t) => (
              <li key={t.gid} className="flex items-center gap-2 text-sm text-ink/80">
                <span className="truncate">{t.name}</span>
                <button
                  type="button"
                  onClick={() => forget(e, t.gid)}
                  disabled={busy === t.gid}
                  className="ml-auto shrink-0 text-xs text-muted underline-offset-2 hover:underline disabled:opacity-50"
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
