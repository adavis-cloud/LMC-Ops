import type { AsanaTask } from "./asana";

export type Confidence = "high" | "medium" | "low" | "none";

export interface EmailFields {
  subject: string;
  senderName: string;
  senderEmail: string;
}

export interface TaskRef {
  gid: string;
  name: string;
  url: string;
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

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 4 && !STOPWORDS.has(t),
  );
}

function scoreTask(email: EmailFields, task: AsanaTask): number {
  const name = task.name.toLowerCase();
  let score = 0;

  const senderEmail = email.senderEmail.toLowerCase();
  if (senderEmail && name.includes(senderEmail)) score += 1;

  const senderName = email.senderName.toLowerCase().trim();
  if (senderName.length > 2 && name.includes(senderName)) score += 0.7;

  // Subject keyword overlap (minor signal; subjects are often generic).
  const subjTokens = new Set(tokens(email.subject));
  const nameTokens = tokens(task.name);
  if (subjTokens.size && nameTokens.length) {
    const shared = nameTokens.filter((t) => subjTokens.has(t)).length;
    score += Math.min(0.6, (shared / subjTokens.size) * 0.6);
  }

  return score;
}

function toRef(t: AsanaTask): TaskRef {
  return { gid: t.gid, name: t.name, url: t.url };
}

/** Rank candidate tasks against an email and bucket the best into a confidence. */
export function matchTasks(email: EmailFields, tasks: AsanaTask[]): MatchResult {
  const scored = tasks
    .map((t) => ({ task: t, score: scoreTask(email, t) }))
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { confidence: "none", alternates: [] };

  const best = scored[0];
  const confidence: Confidence =
    best.score >= 1 ? "high" : best.score >= 0.6 ? "medium" : "low";

  return {
    confidence,
    match: toRef(best.task),
    alternates: scored.slice(1, 3).map((s) => toRef(s.task)),
  };
}
