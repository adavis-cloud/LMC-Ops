"use client";

import { useCallback, useEffect, useState } from "react";

interface SlackUser {
  id: string;
  name: string;
  email?: string;
}
interface AsanaUser {
  gid: string;
  name: string;
  email?: string;
}
interface RosterEntry {
  slackUserId: string;
  slackName: string;
  asanaGid: string;
  asanaName: string;
}
interface ActionLogEntry {
  id: string;
  type: "task_created" | "comment_added";
  at: number;
  by: string;
  summary: string;
  taskName?: string;
  taskUrl?: string;
  assignee?: string;
}

export default function Slack({
  kvReady,
  connected,
  teamName,
  asanaLinked,
  notice,
}: {
  kvReady: boolean;
  connected: boolean;
  teamName?: string;
  asanaLinked: boolean;
  notice?: string;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Slack</h2>
          <p className="mt-1 text-sm text-muted">
            Turn Slack messages into Asana tasks and comments — and see what was done here.
          </p>
        </div>
        {connected && (
          <form action="/api/slack/disconnect" method="post">
            <button
              type="submit"
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-cream"
            >
              Disconnect
            </button>
          </form>
        )}
      </div>

      {notice === "error" && <Banner tone="error">Connecting Slack failed — please try again.</Banner>}
      {notice === "denied" && <Banner tone="muted">Slack connection was cancelled.</Banner>}
      {notice === "connected" && <Banner tone="ok">Slack connected. 🎉</Banner>}

      {!kvReady ? (
        <Banner tone="error">
          Storage isn’t configured yet. Set <code className="font-mono">KV_REST_API_URL</code> and{" "}
          <code className="font-mono">KV_REST_API_TOKEN</code> (see SLACK-SETUP.md), then reload.
        </Banner>
      ) : !connected ? (
        <a
          href="/api/slack/connect"
          className="inline-flex w-fit items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-medium text-cream transition hover:bg-brand-hover"
        >
          Connect Slack{teamName ? ` to ${teamName}` : ""}
        </a>
      ) : (
        <>
          <AsanaLink linked={asanaLinked} />
          <HowTo />
          <RosterEditor />
          <Activity />
        </>
      )}
    </section>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "error" | "muted" | "ok";
  children: React.ReactNode;
}) {
  const cls =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "ok"
        ? "border-green-200 bg-green-50 text-green-700"
        : "border-line bg-cream text-muted";
  return <p className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</p>;
}

function AsanaLink({ linked }: { linked: boolean }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const isLinked = linked || state === "done";

  async function link() {
    setState("saving");
    try {
      const res = await fetch("/api/slack/sync-asana", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setState(res.ok ? "done" : "error");
      if (!res.ok) console.error(data);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-sm">
        <span className="font-medium text-ink">Asana automation</span>
        <span className="ml-2 text-muted">
          {isLinked
            ? "Linked — Slack can create tasks and comments."
            : "Not linked. Connect Asana on the Asana page, then link it here."}
        </span>
      </div>
      <button
        type="button"
        onClick={link}
        disabled={state === "saving"}
        className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-ink transition hover:bg-cream disabled:opacity-50"
      >
        {state === "saving" ? "Linking…" : isLinked ? "Re-link" : "Link Asana"}
      </button>
    </div>
  );
}

function HowTo() {
  return (
    <div className="rounded-xl border border-line bg-cream px-4 py-3 text-sm text-muted">
      <p className="font-medium text-ink">From Slack</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5">
        <li>
          On any message, open <span className="font-medium text-ink">⋯ More actions →
          Create Asana task</span>. Confirm the name, assignee, and due date.
        </li>
        <li>
          Use <span className="font-medium text-ink">⋯ → Comment on Asana task</span> to
          log a note on an existing task.
        </li>
        <li>
          Or type <code className="font-mono">/task order more bags by friday</code> to start
          from scratch.
        </li>
      </ul>
    </div>
  );
}

function RosterEditor() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slackUsers, setSlackUsers] = useState<SlackUser[]>([]);
  const [asanaUsers, setAsanaUsers] = useState<AsanaUser[]>([]);
  const [map, setMap] = useState<Record<string, string>>({}); // slackId -> asanaGid
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/slack/roster");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load people");
      setSlackUsers(data.slackUsers ?? []);
      setAsanaUsers(data.asanaUsers ?? []);
      const initial: Record<string, string> = {};
      for (const r of data.roster ?? []) initial[r.slackUserId] = r.asanaGid;
      setMap(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load people");
    } finally {
      setLoading(false);
    }
  }, []);

  async function save() {
    setError(null);
    setSaved(false);
    const roster: RosterEntry[] = Object.entries(map)
      .filter(([, gid]) => gid)
      .map(([slackUserId, asanaGid]) => ({
        slackUserId,
        slackName: slackUsers.find((u) => u.id === slackUserId)?.name ?? "",
        asanaGid,
        asanaName: asanaUsers.find((u) => u.gid === asanaGid)?.name ?? "",
      }));
    try {
      const res = await fetch("/api/slack/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">People (Slack → Asana)</h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-ink transition hover:bg-cream disabled:opacity-50"
        >
          {loading ? "Loading…" : slackUsers.length ? "Reload" : "Load people"}
        </button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {slackUsers.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {slackUsers.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-2.5"
              >
                <span className="text-sm text-ink">{u.name}</span>
                <select
                  value={map[u.id] ?? ""}
                  onChange={(e) => setMap((m) => ({ ...m, [u.id]: e.target.value }))}
                  className="rounded-lg border border-line bg-cream px-3 py-1.5 text-sm text-ink"
                >
                  <option value="">— not mapped —</option>
                  {asanaUsers.map((a) => (
                    <option key={a.gid} value={a.gid}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              className="w-fit rounded-full bg-brand px-6 py-2 text-sm font-medium text-cream transition hover:bg-brand-hover"
            >
              Save mapping
            </button>
            {saved && <span className="text-sm text-green-700">Saved.</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Activity() {
  const [actions, setActions] = useState<ActionLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/slack/activity");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load activity");
      setActions(data.actions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Recent Slack actions</h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-ink transition hover:bg-cream disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {actions !== null && (
        <ul className="flex flex-col gap-2">
          {actions.length === 0 ? (
            <li className="rounded-xl border border-line bg-surface px-4 py-10 text-center text-sm text-muted">
              Nothing yet. Create a task from Slack and it’ll show up here.
            </li>
          ) : (
            actions.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-line bg-surface px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink">
                    {a.type === "task_created" ? "🟢 " : "💬 "}
                    {a.taskUrl ? (
                      <a
                        href={a.taskUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline"
                      >
                        {a.summary}
                      </a>
                    ) : (
                      a.summary
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{when(a.at)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">via {a.by}</p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function when(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
