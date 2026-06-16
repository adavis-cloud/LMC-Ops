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
}

export interface TaskRef {
  gid: string;
  name: string;
  url: string;
  completed: boolean;
  section: string;
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

  const senderEmail = email.senderEmail.toLowerCase();
  if (senderEmail && hay.includes(senderEmail)) {
    score += 3; // exact email = strongest, unambiguous signal
    reasons.push("sender email in task");
  }

  // Verbatim multi-word phrase shared between the subject/body and the task —
  // e.g. "treetops collective". This is the single most reliable content match,
  // so it outranks generic single-word overlap by design.
  const subject = stripReply(email.subject);
  const phraseHay = `${subject}\n${email.body ?? ""}`;
  for (const p of phrases(phraseHay)) {
    if (hay.includes(p)) {
      score += 3;
      reasons.push(`phrase "${p}"`);
      break; // one strong phrase is enough; don't stack
    }
  }

  // Organization from the sender's email domain (skips gmail/yahoo/etc).
  const org = orgRoot(senderEmail);
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
  const greet = greetingName(email.body ?? "");
  if (greet.length >= 3 && hay.includes(greet)) {
    score += 1.5;
    reasons.push(`recipient "${greet}"`);
  }

  // Full sender name (only counts when the whole name appears, not just "Sarah").
  const senderName = email.senderName.toLowerCase().trim();
  if (senderName.length > 2 && hay.includes(senderName)) {
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
  const confidence: Confidence =
    best.score >= 3 ? "high" : best.score >= 1.5 ? "medium" : "low";

  return {
    confidence,
    match: toRef(best.task),
    reasons: best.reasons,
    alternates: scored.slice(1, 3).map((s) => toRef(s.task)),
  };
}
