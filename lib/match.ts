import type { AsanaTask } from "./asana";

export type Confidence = "high" | "medium" | "low" | "none";

export interface EmailFields {
  subject: string;
  senderName: string;
  senderEmail: string;
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
  alternates: TaskRef[];
}

const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "our", "with", "from", "new", "form",
  "entry", "contact", "email", "message", "request", "inquiry", "hello", "hi",
  "re", "fwd", "via", "about", "regarding", "would", "like", "want", "need",
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

/** "aochoa@ayayouth.org" -> "ayayouth" (org name); "" for personal providers. */
function orgRoot(senderEmail: string): string {
  const domain = senderEmail.split("@")[1]?.toLowerCase();
  if (!domain || FREE_EMAIL.has(domain)) return "";
  const labels = domain.split(".");
  const root = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return root.length >= 4 ? root : "";
}

function scoreTask(email: EmailFields, task: AsanaTask): number {
  // Wholesale/catering tasks paste the full Square form into the description,
  // so the customer's email/name/org usually appear in the notes, not the name.
  const hay = `${task.name}\n${task.notes}`.toLowerCase();
  let score = 0;

  const senderEmail = email.senderEmail.toLowerCase();
  if (senderEmail && hay.includes(senderEmail)) score += 2; // exact email = strongest

  const senderName = email.senderName.toLowerCase().trim();
  if (senderName.length > 2 && hay.includes(senderName)) score += 1;

  const org = orgRoot(senderEmail);
  // Compare against a space/punctuation-stripped haystack too, so a domain like
  // "thestopoverexperience" matches the notes text "The Stopover Experience".
  const compact = hay.replace(/[^a-z0-9]/g, "");
  if (org && (hay.includes(org) || compact.includes(org))) score += 1;

  // Business name from the form (e.g. "AYA Youth") is a strong signal.
  const business = email.business?.toLowerCase().trim();
  if (business && business.length > 2) {
    const bizCompact = business.replace(/[^a-z0-9]/g, "");
    if (hay.includes(business) || compact.includes(bizCompact)) score += 1.5;
  }

  // Subject keyword overlap (minor; subjects are often generic).
  const subjTokens = new Set(tokens(email.subject));
  const nameTokens = tokens(task.name);
  if (subjTokens.size && nameTokens.length) {
    const shared = nameTokens.filter((t) => subjTokens.has(t)).length;
    score += Math.min(0.5, (shared / subjTokens.size) * 0.5);
  }

  return score;
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
    .map((t) => ({ task: t, score: scoreTask(email, t) }))
    .filter((s) => s.score > 0.3)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { confidence: "none", alternates: [] };

  const best = scored[0];
  const confidence: Confidence =
    best.score >= 1.5 ? "high" : best.score >= 0.8 ? "medium" : "low";

  return {
    confidence,
    match: toRef(best.task),
    alternates: scored.slice(1, 3).map((s) => toRef(s.task)),
  };
}
