"use client";

import { useState } from "react";

interface AsanaTask {
  gid: string;
  name: string;
  dueOn: string | null;
  url: string;
  projects: string[];
}
interface AsanaProject {
  gid: string;
  name: string;
}

const VIEWS = [
  { key: "mine", label: "My tasks" },
  { key: "due", label: "Due soon" },
  { key: "project", label: "Project" },
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
  const [projects, setProjects] = useState<AsanaProject[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadTasks(v: string, pid?: string) {
    setLoading(true);
    setError(null);
    try {
      const qs = v === "project" ? `view=project&project=${pid}` : `view=${v}`;
      const res = await fetch(`/api/asana/tasks?${qs}`);
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

  async function pickView(v: string) {
    setView(v);
    if (v === "project") {
      setTasks(null);
      if (!projects) {
        try {
          const res = await fetch("/api/asana/projects");
          const data = await res.json();
          if (res.ok) setProjects(data.projects);
          else throw new Error(data.error);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't load projects");
        }
      }
    } else {
      loadTasks(v);
    }
  }

  return (
    <section className="mt-10 flex flex-col gap-5 border-t border-line pt-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Asana</h2>
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

          {view === "project" && (
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                if (e.target.value) loadTasks("project", e.target.value);
              }}
              className="w-fit rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            >
              <option value="">
                {projects ? "Choose a project…" : "Loading projects…"}
              </option>
              {projects?.map((p) => (
                <option key={p.gid} value={p.gid}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

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
