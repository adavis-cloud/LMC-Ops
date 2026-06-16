"use client";

import { useState } from "react";

interface AsanaTask {
  gid: string;
  name: string;
  dueOn: string | null;
  url: string;
  projects: string[];
}

const VIEWS = [
  { key: "mine", label: "My tasks" },
  { key: "outgoing", label: "Outgoing Activity" },
] as const;

export default function Asana({
  connected,
  notice,
}: {
  connected: boolean;
  notice?: string;
}) {
  const [view, setView] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AsanaTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickView(v: string) {
    setView(v);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/asana/tasks?view=${v}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Asana request failed");
      setTasks(data.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Asana request failed");
      setTasks(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            Asana tasks
          </h2>
          <p className="mt-1 text-sm text-muted">
            {connected
              ? "Pull your tasks from Asana."
              : "Connect Asana to see your tasks here."}
          </p>
        </div>
        {connected && (
          <form action="/api/asana/disconnect" method="post">
            <button
              type="submit"
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-cream"
            >
              Disconnect
            </button>
          </form>
        )}
      </div>

      {notice === "error" && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Connecting Asana failed — please try again.
        </p>
      )}
      {notice === "denied" && (
        <p className="rounded-xl border border-line bg-cream px-4 py-3 text-sm text-muted">
          Asana connection was cancelled.
        </p>
      )}

      {!connected ? (
        <a
          href="/api/asana/connect"
          className="inline-flex w-fit items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-medium text-cream transition hover:bg-brand-hover"
        >
          Connect Asana
        </a>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => pickView(v.key)}
                disabled={loading}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                  view === v.key
                    ? "border-brand bg-brand text-cream"
                    : "border-line bg-surface text-ink hover:bg-cream"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {loading && <p className="text-sm text-muted">Loading…</p>}

          {tasks !== null && !loading && (
            <ul className="flex flex-col gap-2">
              {tasks.length === 0 && (
                <li className="rounded-xl border border-line bg-surface px-4 py-10 text-center text-sm text-muted">
                  No tasks here. 🎉
                </li>
              )}
              {tasks.map((t) => (
                <li
                  key={t.gid}
                  className="rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-accent/60 hover:shadow-sm"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-semibold text-ink hover:underline"
                    >
                      {t.name || "(untitled task)"}
                    </a>
                    {t.dueOn && (
                      <span
                        className={`shrink-0 text-xs ${
                          isOverdue(t.dueOn) ? "font-medium text-red-600" : "text-muted"
                        }`}
                      >
                        {formatDue(t.dueOn)}
                      </span>
                    )}
                  </div>
                  {t.projects.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.projects.map((p) => (
                        <span
                          key={p}
                          className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-brand"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function isOverdue(due: string): boolean {
  return new Date(due + "T23:59:59") < new Date();
}

function formatDue(due: string): string {
  const d = new Date(due + "T00:00:00");
  if (Number.isNaN(d.getTime())) return due;
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
