/**
 * Durable match feedback — the app's memory of which Asana task belongs to
 * which customer, learned from the user's "✓ Correct" / "✗ Not this task"
 * corrections. Lives in KV (Upstash); when KV isn't configured every function
 * degrades to a no-op so the UI still works, it just doesn't get smarter.
 *
 * Corrections are stored under several GENERALIZATION KEYS so a single fix
 * spreads as far as is safe:
 *   - email:<addr>        the exact customer (most specific)
 *   - domain:<org.tld>    everyone at that organization
 *   - phrase:<org name>   any email mentioning that org name (even from Gmail)
 * Internal/teammate senders never produce an email/domain key, so one
 * rejection can't taint all internal mail.
 */

import {
  kvConfigured,
  kvDel,
  kvGetJSON,
  kvHGetAll,
  kvHSet,
  kvScanKeys,
  kvSetJSON,
} from "./kv";
import { isFreeEmailDomain, orgPhraseKeys } from "./match";
import type { MatchMemory } from "./match";

const rejectKey = (key: string) => `learn:reject:${key}`;
const confirmKey = (key: string) => `learn:confirm:${key}`;
/** gid → task name, so the "what I've learned" view can show readable names. */
const NAMES_KEY = "learn:names";

const REJECT_PREFIX = "learn:reject:";
const CONFIRM_PREFIX = "learn:confirm:";

interface ConfirmRecord {
  gids: string[];
  section?: string;
  at: number;
}

interface KeyInput {
  senderEmail: string | null | undefined;
  selfEmail: string | null | undefined;
  subject?: string;
  body?: string;
}

/**
 * The customer's email, or null when we shouldn't key learning on this sender
 * (internal teammate, or no usable address).
 */
export function customerKeyFor(
  senderEmail: string | null | undefined,
  selfEmail: string | null | undefined,
): string | null {
  const email = (senderEmail ?? "").toLowerCase().trim();
  const senderDomain = email.split("@")[1];
  if (!email || !senderDomain) return null;
  const selfDomain = (selfEmail ?? "").toLowerCase().split("@")[1];
  if (selfDomain && senderDomain === selfDomain) return null; // internal sender
  return email;
}

/**
 * All generalization keys for an email, most-specific first. Used identically
 * when loading memory and when recording a correction, so they always agree.
 */
export function learningKeysFor(input: KeyInput): string[] {
  const keys: string[] = [];
  const email = customerKeyFor(input.senderEmail, input.selfEmail);
  if (email) {
    keys.push(`email:${email}`);
    const domain = email.split("@")[1];
    if (domain && !isFreeEmailDomain(domain)) keys.push(`domain:${domain}`);
  }
  for (const p of orgPhraseKeys(input.subject ?? "", input.body ?? "")) {
    keys.push(`phrase:${p}`);
  }
  return keys;
}

/** Load and merge everything learned across a set of keys (union of signals). */
export async function loadMatchMemory(
  keys: string[],
): Promise<MatchMemory | undefined> {
  if (!keys.length || !kvConfigured()) return undefined;

  const records = await Promise.all(
    keys.map(async (key) => ({
      rej: (await kvGetJSON<string[]>(rejectKey(key))) ?? [],
      conf: await kvGetJSON<ConfirmRecord>(confirmKey(key)),
    })),
  );

  const confirmedGids = new Set<string>();
  const rejectedGids = new Set<string>();
  let preferredSection: string | undefined;
  for (const { rej, conf } of records) {
    rej.forEach((g) => rejectedGids.add(g));
    conf?.gids?.forEach((g) => confirmedGids.add(g));
    // Keys are most-specific-first, so the first section wins.
    if (!preferredSection && conf?.section) preferredSection = conf.section;
  }

  return {
    confirmedGids: [...confirmedGids],
    rejectedGids: [...rejectedGids],
    preferredSection,
  };
}

/** Remember that `taskGid` is NOT the right task — across all given keys. */
export async function recordReject(
  keys: string[],
  taskGid: string,
  taskName?: string,
): Promise<void> {
  if (!kvConfigured() || !keys.length) return;
  if (taskName) await kvHSet(NAMES_KEY, taskGid, taskName);
  await Promise.all(
    keys.map(async (key) => {
      const k = rejectKey(key);
      const cur = (await kvGetJSON<string[]>(k)) ?? [];
      if (!cur.includes(taskGid)) cur.push(taskGid);
      await kvSetJSON(k, cur.slice(-50));
    }),
  );
}

/** Remember that `taskGid` IS the right task (+ its section) — across all keys. */
export async function recordConfirm(
  keys: string[],
  taskGid: string,
  section?: string,
  taskName?: string,
  now = Date.now(),
): Promise<void> {
  if (!kvConfigured() || !keys.length) return;
  if (taskName) await kvHSet(NAMES_KEY, taskGid, taskName);
  await Promise.all(
    keys.map(async (key) => {
      const ck = confirmKey(key);
      const cur = (await kvGetJSON<ConfirmRecord>(ck)) ?? { gids: [], at: 0 };
      if (!cur.gids.includes(taskGid)) cur.gids.push(taskGid);
      cur.gids = cur.gids.slice(-20);
      if (section) cur.section = section;
      cur.at = now;
      await kvSetJSON(ck, cur);

      // A confirmation overrides any earlier rejection of the same task here.
      const rk = rejectKey(key);
      const rej = (await kvGetJSON<string[]>(rk)) ?? [];
      if (rej.includes(taskGid)) {
        await kvSetJSON(rk, rej.filter((g) => g !== taskGid));
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// "What I've learned" view — list and undo stored corrections.
// ---------------------------------------------------------------------------

export type LearnScope = "email" | "domain" | "org name";

export interface LearnedEntry {
  /** The inner key, e.g. "domain:treetopscollective.org". */
  key: string;
  scope: LearnScope;
  /** Human-readable subject, e.g. "treetopscollective.org". */
  label: string;
  verdict: "confirm" | "reject";
  tasks: { gid: string; name: string }[];
  section?: string;
}

function describe(innerKey: string): { scope: LearnScope; label: string } {
  if (innerKey.startsWith("email:")) return { scope: "email", label: innerKey.slice(6) };
  if (innerKey.startsWith("domain:")) return { scope: "domain", label: innerKey.slice(7) };
  if (innerKey.startsWith("phrase:")) return { scope: "org name", label: innerKey.slice(7) };
  return { scope: "org name", label: innerKey };
}

/** Every stored correction, with task names resolved, for the learnings page. */
export async function listLearnings(): Promise<LearnedEntry[]> {
  if (!kvConfigured()) return [];
  const [rejKeys, confKeys, names] = await Promise.all([
    kvScanKeys(`${REJECT_PREFIX}*`),
    kvScanKeys(`${CONFIRM_PREFIX}*`),
    kvHGetAll(NAMES_KEY),
  ]);
  const taskOf = (gid: string) => ({ gid, name: names[gid] ?? gid });
  const out: LearnedEntry[] = [];

  for (const k of rejKeys) {
    const inner = k.slice(REJECT_PREFIX.length);
    const gids = (await kvGetJSON<string[]>(k)) ?? [];
    if (gids.length) {
      out.push({ key: inner, ...describe(inner), verdict: "reject", tasks: gids.map(taskOf) });
    }
  }
  for (const k of confKeys) {
    const inner = k.slice(CONFIRM_PREFIX.length);
    const rec = await kvGetJSON<ConfirmRecord>(k);
    if (rec?.gids?.length) {
      out.push({
        key: inner,
        ...describe(inner),
        verdict: "confirm",
        tasks: rec.gids.map(taskOf),
        section: rec.section,
      });
    }
  }
  // Most specific first, confirmations before rejections.
  const rank = { email: 0, domain: 1, "org name": 2 } as const;
  return out.sort(
    (a, b) => rank[a.scope] - rank[b.scope] || a.verdict.localeCompare(b.verdict),
  );
}

/** Undo a correction: drop one task from a key, or the whole key when no gid. */
export async function forget(
  innerKey: string,
  verdict: "confirm" | "reject",
  gid?: string,
): Promise<void> {
  if (!kvConfigured()) return;
  if (verdict === "reject") {
    const k = rejectKey(innerKey);
    if (!gid) return void kvDel(k);
    const cur = (await kvGetJSON<string[]>(k)) ?? [];
    const next = cur.filter((g) => g !== gid);
    await (next.length ? kvSetJSON(k, next) : kvDel(k));
  } else {
    const k = confirmKey(innerKey);
    if (!gid) return void kvDel(k);
    const rec = await kvGetJSON<ConfirmRecord>(k);
    if (!rec) return;
    rec.gids = rec.gids.filter((g) => g !== gid);
    await (rec.gids.length ? kvSetJSON(k, rec) : kvDel(k));
  }
}
