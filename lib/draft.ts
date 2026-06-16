/**
 * Build a suggested Asana task from a parsed inquiry, matching Last Mile's task
 * style. Everything here is a SUGGESTION — the user reviews/edits before saving.
 */

import type { ParsedInquiry } from "./parse";

export interface TaskDraft {
  name: string;
  section: string; // "" if unsure
  dueOn: string | null; // YYYY-MM-DD
  notes: string;
}

const SECTION_RULES: { section: string; re: RegExp }[] = [
  { section: "SUBSCRIPTIONS", re: /\b(subscription|subscribe|recurring|every month|monthly)\b/i },
  { section: "SPACE RENTALS & ON-SITE COMMUNITY EVENTS", re: /\b(space rental|rent the space|rent your|venue|host (an|a|our)|on-?site|community event)\b/i },
  { section: "WHOLESALE", re: /\b(wholesale|bulk|by the pound|per pound|\d+\s?(lb|lbs|pounds)|cases|for (our|your) (shop|store|cafe|café)|resell)\b/i },
  { section: "CATERING", re: /\b(catering|cater|air ?pot|carafe|platter|coffee box|coffee traveler|guests|wedding|party|event)\b/i },
  { section: "ONLINE ORDERS", re: /\b(online order|pickup order|pick-?up order|to-?go order)\b/i },
];

function guessSection(text: string): string {
  for (const { section, re } of SECTION_RULES) {
    if (re.test(text)) return section;
  }
  return "";
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${+m}/${+d}` : iso;
}

/**
 * Task name in Last Mile's style: {customer} ({DELIVERY/PICKUP} @ time),
 * {customer} — {occasion}, or {customer} {m/d}. Customer prefers the business
 * name, then the contact, then the email handle.
 */
function buildTaskName(p: ParsedInquiry): string {
  const who =
    p.business?.trim() ||
    p.contactName?.trim() ||
    p.email?.split("@")[0] ||
    "New inquiry";

  let descriptor = "";
  if (p.fulfillment && p.time) {
    descriptor = `(${p.fulfillment.toUpperCase()} @ ${p.time})`;
  } else if (p.occasion) {
    descriptor = `— ${p.occasion}`;
  } else if (p.fulfillment) {
    descriptor = `(${p.fulfillment.toUpperCase()})`;
  } else if (p.eventDate) {
    descriptor = shortDate(p.eventDate);
  }

  return descriptor ? `${who} ${descriptor}` : who;
}

export function buildTaskDraft(p: ParsedInquiry): TaskDraft {
  const section = guessSection(`${p.subject}\n${p.occasion}\n${p.message}`);
  return {
    name: buildTaskName(p),
    section,
    dueOn: p.eventDate,
    notes: p.notes,
  };
}
