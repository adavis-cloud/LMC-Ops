import type { GmailMessage } from "./gmail";

export interface FilterDef {
  label: string;
  query: string;
  /** If true, results are scored and re-ranked (see rankByUrgency). */
  ranked?: boolean;
}

/**
 * Predefined inbox filters, keyed by the value passed as `?filter=`.
 * Queries use Gmail's standard search syntax. Tunable as we learn real
 * sender/subject patterns (especially the Square contact form).
 */
export const FILTERS: Record<string, FilterDef> = {
  catering: {
    label: "Catering",
    query:
      // events/parties/weddings
      "(catering OR cater OR event OR party OR wedding OR meeting OR guests OR " +
      // product names
      '"coffee box" OR "box of coffee" OR "coffee traveler" OR airpot OR carafe OR ' +
      'platter OR "pastry tray" OR pastries OR "large order" OR "order for" OR ' +
      // office / recurring
      '"office coffee" OR "for the office" OR "for our team" OR "recurring order" OR ' +
      '"standing order" OR "weekly delivery" OR "drop off") ' +
      "newer_than:1y -category:promotions",
  },
  wholesale: {
    label: "Wholesale",
    query:
      '(wholesale OR bulk OR reseller OR "whole bean" OR "by the pound" OR ' +
      '"per pound" OR cases OR "purchase order" OR "carry your" OR "stock your" OR ' +
      '"for our shop" OR "for our store" OR "for our cafe") ' +
      "newer_than:1y -category:promotions",
  },
  bill: {
    label: "Bills",
    // Bills/invoices you RECEIVE and need to pay (suppliers, utilities, rent,
    // software). Not Square's incoming-payout emails.
    query:
      '(invoice OR "invoice #" OR "amount due" OR "balance due" OR ' +
      '"payment due" OR "past due" OR "please pay" OR bill OR billing OR ' +
      "statement) newer_than:1y -category:promotions -category:social",
  },
  square: {
    label: "Square forms",
    // Square Online contact-form notifications all arrive with this subject:
    //   "New Form Entry from <customer email>: <form name>"
    query: 'subject:"New Form Entry" newer_than:1y',
  },
  urgent: {
    label: "Urgent",
    ranked: true,
    // Broad-but-clean candidate net: recent, non-promotional, human mail that
    // is unread/important/starred. Scoring (below) does the real ranking, so
    // urgency without keywords (e.g. "our event is Saturday") still surfaces.
    query:
      "(is:unread OR is:important OR is:starred) newer_than:30d " +
      "-category:promotions -category:social -category:updates " +
      "-from:no-reply -from:noreply",
  },
};

export interface ScoredMessage extends GmailMessage {
  score: number;
  reasons: string[];
}

const URGENT_WORDS =
  /\b(urgent|asap|emergency|immediately|right away|time[- ]sensitive|critical|need (this|it) (by|today)|by end of day|\beod\b)\b/i;
const DATE_SOON =
  /\b(today|tonight|tomorrow|this (morning|afternoon|evening|week|weekend)|by (this|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(st|nd|rd|th))\b/i;
const FOLLOWUP =
  /\b(follow(ing)? up|haven'?t heard|circling back|checking in|second (email|time)|friendly reminder|just a reminder|still waiting|any update)\b/i;
const QUESTION =
  /(\?|can you|could you|would you|please (confirm|advise|respond|let me know)|let me know)/i;
const AUTOMATED =
  /(no-?reply|do-?not-?reply|donotreply|notification|mailer|newsletter|automated)/i;

/** Score a single message for likely urgency, with human-readable reasons. */
export function scoreUrgency(m: GmailMessage): { score: number; reasons: string[] } {
  const subject = m.subject ?? "";
  const text = `${subject} ${m.snippet ?? ""}`;
  const labels = m.labelIds ?? [];
  let score = 0;
  const reasons: string[] = [];

  if (URGENT_WORDS.test(subject)) {
    score += 3;
    reasons.push("urgent wording");
  } else if (URGENT_WORDS.test(text)) {
    score += 1;
    reasons.push("urgent wording");
  }

  if (DATE_SOON.test(text)) {
    score += 3;
    reasons.push("time-sensitive");
  }
  if (FOLLOWUP.test(text)) {
    score += 2;
    reasons.push("awaiting reply");
  }
  if (QUESTION.test(text)) {
    score += 1;
    reasons.push("asks a question");
  }

  if (labels.includes("UNREAD")) {
    score += 2;
    reasons.push("unread");
  }
  if (labels.includes("IMPORTANT")) {
    score += 1;
    reasons.push("important");
  }
  if (labels.includes("STARRED")) {
    score += 1;
    reasons.push("starred");
  }

  if (AUTOMATED.test(m.from ?? "")) score -= 3;

  const t = Date.parse(m.date);
  if (!Number.isNaN(t)) {
    const days = (Date.now() - t) / 86_400_000;
    if (days <= 2) {
      score += 2;
      reasons.push("just arrived");
    } else if (days <= 7) {
      score += 1;
    }
  }

  return { score, reasons };
}

/** Re-rank messages most-urgent-first and attach scores + reasons. */
export function rankByUrgency(messages: GmailMessage[]): ScoredMessage[] {
  return messages
    .map((m) => ({ ...m, ...scoreUrgency(m) }))
    .sort((a, b) => b.score - a.score);
}
