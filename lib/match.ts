import type { AsanaTask } from "./asana";

export type Confidence = "high" | "medium" | "low" | "none";

export interface EmailFields {
  subject: string;
  senderName: string;
  senderEmail: string;
  /** Full plain-text body. The customer is often the recipient ("Hi Gaby"),
   *  not the sender, so we mine the body for names/orgs too. */
  body?: string;
  business?: string;
  /** The signed-in user's own address. Lets us tell an outside customer apart
   *  from ourselves / a teammate, so our own domain is never an "org" signal. */
  selfEmail?: string;
  /** The email's Date header — used to down-rank stale tasks (a 2025 order is
   *  not the live match for a 2026 email). */
  emailDate?: string;
  /** What we've learned from past corrections for this customer (see MatchMemory). */
  memory?: MatchMemory;
}

export interface TaskRef {
  gid: string;
  name: string;
  url: string;
  completed: boolean;
  section: string;
}

/**
 * What the app has learned from the user's past corrections for one customer.
 * Persisted in KV (see lib/match-memory.ts); absent when KV isn't configured.
 */
export interface MatchMemory {
  /** Tasks the user explicitly confirmed — strongly boosted. */
  confirmedGids: string[];
  /** Tasks the user said were wrong — excluded from results. */
  rejectedGids: string[];
  /** The section this customer's tasks usually live in. */
  preferredSection?: string;
}

export interface MatchResult {
  confidence: Confidence;
  match?: TaskRef;
  /** Short human-readable reasons the top task matched (for the UI / debugging). */
  reasons?: string[];
  alternates: TaskRef[];
}

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "our", "with", "from", "new", "form",
  "entry", "contact", "email", "message", "request", "inquiry", "hello", "hi",
  "re", "fwd", "via", "about", "regarding", "would", "like", "want", "need",
  "order", "coffee", "beans", "bags", "weekly", "pickup", "ready", "thanks",
]);

// Personal-email providers — their domain says nothing about an organization.
const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "comcast.net", "proton.me", "protonmail.com",
]);

// Generic business boilerplate — these phrases appear in countless emails and
// task notes, so they must never count as a meaningful content match.
const PHRASE_STOPLIST = new Set([
  "next steps", "let me know", "look forward", "looking forward", "talk soon",
  "thank you", "thanks again", "follow up", "following up", "touch base",
  "get back", "reach out", "more information", "any questions",
]);

/**
 * Cut off quoted reply history so phrase matching only sees what THIS message
 * actually says — not boilerplate ("next steps") buried in the thread below.
 */
function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    // Common reply/forward delimiters — everything after is quoted history.
    if (
      /^\s*>/.test(line) ||
      /^\s*On .+ wrote:\s*$/i.test(line) ||
      /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) ||
      /^\s*(From|Sent|To|Subject):\s/i.test(line) ||
      /^\s*_{5,}\s*$/.test(line)
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 4 && !STOPWORDS.has(t),
  );
}

/** Drop "Re:/Fwd:" prefixes so they don't pollute phrase extraction. */
function stripReply(subject: string): string {
  return subject.replace(/^((re|fwd|fw)\s*:\s*)+/i, "");
}

/**
 * Maximal runs of adjacent meaningful words — i.e. real phrases like
 * "treetops collective". A stopword (for/and/…) or punctuation breaks a run.
 * Only runs of 2+ words survive: a single word is handled by token overlap.
 */
function phrases(text: string): string[] {
  const out: string[] = [];
  // Split on anything that isn't a letter/number, keeping word order.
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run.join(" "));
    run = [];
  };
  for (const w of words) {
    if (w.length >= 4 && !STOPWORDS.has(w)) run.push(w);
    else flush();
  }
  flush();
  return out;
}

/**
 * The customer is frequently the *recipient* in a reply thread. Pull the first
 * name out of an opening greeting: "Hi Gaby," → "gaby", "Dear Sarah" → "sarah".
 */
function greetingName(body: string): string {
  const m = body.match(
    /^[\s>]*(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))[\s,]+([a-z][a-z'-]+)/im,
  );
  return m?.[1]?.toLowerCase() ?? "";
}

/**
 * How many days older than the email a task's last activity can be before it's
 * considered stale. ~6 months: a new inbound email about a recurring order is
 * very unlikely to belong to a task untouched since last season.
 */
const STALE_DAYS = 180;

/** Days between the email and the task's last activity (null if either unknown). */
function staleDays(emailDate: string | undefined, task: AsanaTask): number | null {
  const taskDate = task.modifiedAt ?? task.dueOn;
  if (!emailDate || !taskDate) return null;
  const e = Date.parse(emailDate);
  const t = Date.parse(taskDate);
  if (Number.isNaN(e) || Number.isNaN(t)) return null;
  return (e - t) / 86_400_000;
}

/** "aochoa@ayayouth.org" -> "ayayouth" (org name); "" for personal providers. */
function orgRoot(senderEmail: string): string {
  const domain = senderEmail.split("@")[1]?.toLowerCase();
  if (!domain || FREE_EMAIL.has(domain)) return "";
  const labels = domain.split(".");
  const root = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return root.length >= 4 ? root : "";
}

interface Scored {
  score: number;
  reasons: string[];
}

function scoreTask(email: EmailFields, task: AsanaTask): Scored {
  // Wholesale/catering tasks paste the full Square form into the description,
  // so the customer's email/name/org usually appear in the notes, not the name.
  const hay = `${task.name}\n${task.notes}`.toLowerCase();
  const compact = hay.replace(/[^a-z0-9]/g, "");
  const reasons: string[] = [];
  let score = 0;

  // Learned corrections take priority over every heuristic below.
  const mem = email.memory;
  if (mem?.rejectedGids.includes(task.gid)) {
    // The user told us this task is wrong for this customer — never suggest it.
    return { score: -100, reasons: [] };
  }
  if (mem?.confirmedGids.includes(task.gid)) {
    score += 5; // a past confirmation outweighs any content signal
    reasons.push("you confirmed this before");
  }

  // Is this email from us / a teammate rather than an outside customer? If so,
  // the SENDER describes our side, not the customer — so the sender's name,
  // email, and (own) domain are useless signals and we lean on the subject and
  // the recipient ("Hi Gaby") instead.
  const senderEmail = email.senderEmail.toLowerCase();
  const senderDomain = senderEmail.split("@")[1] ?? "";
  const selfDomain = (email.selfEmail ?? "").toLowerCase().split("@")[1] ?? "";
  const internal = !!senderDomain && senderDomain === selfDomain;

  if (!internal && senderEmail && hay.includes(senderEmail)) {
    score += 3; // exact email = strongest, unambiguous signal
    reasons.push("sender email in task");
  }

  // Verbatim multi-word phrase shared between the subject / THIS message's text
  // and the task — e.g. "treetops collective". The single most reliable content
  // match. Quoted reply history and generic boilerplate are excluded so threads
  // can't match on filler like "next steps".
  const subject = stripReply(email.subject);
  const phraseHay = `${subject}\n${stripQuoted(email.body ?? "")}`;
  for (const p of phrases(phraseHay)) {
    if (!PHRASE_STOPLIST.has(p) && hay.includes(p)) {
      score += 3;
      reasons.push(`phrase "${p}"`);
      break; // one strong phrase is enough; don't stack
    }
  }

  // Organization from the sender's email domain (skips gmail/yahoo + our own).
  const org = internal ? "" : orgRoot(senderEmail);
  if (org && (hay.includes(org) || compact.includes(org))) {
    score += 2;
    reasons.push(`org domain "${org}"`);
  }

  // Business name from the Square form (e.g. "AYA Youth") is a strong signal.
  const business = email.business?.toLowerCase().trim();
  if (business && business.length > 2) {
    const bizCompact = business.replace(/[^a-z0-9]/g, "");
    if (hay.includes(business) || compact.includes(bizCompact)) {
      score += 1.5;
      reasons.push(`business "${business}"`);
    }
  }

  // The customer named in the greeting ("Hi Gaby") appearing in the task.
  const greet = greetingName(stripQuoted(email.body ?? ""));
  if (greet.length >= 3 && hay.includes(greet)) {
    score += 1.5;
    reasons.push(`recipient "${greet}"`);
  }

  // Full sender name — only for outside senders (a teammate's name says nothing
  // about which customer this is), and only when the whole name appears.
  const senderName = email.senderName.toLowerCase().trim();
  if (!internal && senderName.length > 2 && hay.includes(senderName)) {
    score += 1;
    reasons.push(`sender name`);
  }

  // Single-word subject overlap — a weak tie-breaker only, capped low so it can
  // never promote an otherwise-unrelated task to a confident match.
  const subjTokens = new Set(tokens(subject));
  const nameTokens = tokens(task.name);
  if (subjTokens.size && nameTokens.length) {
    const shared = nameTokens.filter((t) => subjTokens.has(t)).length;
    score += Math.min(0.5, (shared / subjTokens.size) * 0.5);
  }

  // This customer's tasks usually live in one section (learned from past
  // confirmations) — a gentle nudge toward the right bucket.
  if (
    mem?.preferredSection &&
    task.section &&
    task.section.toLowerCase() === mem.preferredSection.toLowerCase()
  ) {
    score += 0.5;
    reasons.push("usual section for this customer");
  }

  // A finished task is probably already-handled history, not the live match for
  // a fresh inbound email — so an open task with the same evidence always wins.
  if (task.completed) {
    score -= 1.5;
    reasons.push("already completed");
  }

  // Stale task: last touched long before this email arrived (e.g. last year's
  // order). Down-rank in proportion to how far past the window it is.
  const age = staleDays(email.emailDate, task);
  if (age !== null && age > STALE_DAYS) {
    score -= 0.5 + Math.min(1.0, (age - STALE_DAYS) / 365);
    reasons.push("older than this email");
  }

  return { score, reasons };
}

function toRef(t: AsanaTask): TaskRef {
  return {
    gid: t.gid,
    name: t.name,
    url: t.url,
    completed: t.completed,
    section: t.section,
  };
}

/** Rank candidate tasks against an email and bucket the best into a confidence. */
export function matchTasks(email: EmailFields, tasks: AsanaTask[]): MatchResult {
  const scored = tasks
    .map((t) => ({ task: t, ...scoreTask(email, t) }))
    // Floor raised from 0.3 → 0.8: a lone generic token (the old "order" noise)
    // is no longer enough to surface a task as a match.
    .filter((s) => s.score >= 0.8)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { confidence: "none", alternates: [] };

  const best = scored[0];
  let confidence: Confidence =
    best.score >= 3 ? "high" : best.score >= 1.5 ? "medium" : "low";

  // A completed or stale task may still be the most relevant thing we found, but
  // it must never be presented as a confident live match — cap it at "low".
  const isStale =
    best.task.completed || (staleDays(email.emailDate, best.task) ?? 0) > STALE_DAYS;
  if (isStale && confidence !== "low") confidence = "low";

  return {
    confidence,
    match: toRef(best.task),
    reasons: best.reasons,
    alternates: scored.slice(1, 3).map((s) => toRef(s.task)),
  };
}
