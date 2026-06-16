/**
 * Build a suggested Asana task from an inbound email, matching how Last Mile's
 * existing Outgoing Activity tasks look (the Square form pasted into the notes).
 * Everything here is a SUGGESTION — the user reviews/edits before creating.
 */

export interface TaskDraft {
  name: string;
  section: string; // "" if unsure
  dueOn: string | null; // YYYY-MM-DD
  notes: string;
}

// Where the Square email body stops being the form and starts being footer.
const FOOTER_MARKERS = [
  "Email to Last Mile Cafe",
  "Reply via Square",
  "Or reply directly to this email",
  "Manage Your Preferences",
  "Privacy Policy",
  "1955 Broadway",
];

/** Strip Square's footer/header chrome, keep the form block verbatim. */
function cleanFormNotes(body: string): string {
  let text = body.replace(/\r/g, "");
  let cut = text.length;
  for (const m of FOOTER_MARKERS) {
    const i = text.indexOf(m);
    if (i !== -1 && i < cut) cut = i;
  }
  text = text.slice(0, cut);
  // Drop a leading "New Form Entry from ...:" line if it's in the body.
  text = text.replace(/^.*New Form Entry from[^\n]*\n/i, "");
  return text.trim().replace(/\n{3,}/g, "\n\n");
}

/** Trim quoted reply history from a direct email. */
function trimQuoted(body: string): string {
  const cut = body.search(/\nOn .+wrote:|\n[>]{1,}/);
  return (cut === -1 ? body : body.slice(0, cut)).trim();
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

const FREE_EMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com",
]);

/** "aochoa@ayayouth.org" -> "Ayayouth" (rough org label); "" for personal mail. */
function orgFromDomain(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE_EMAIL.has(domain)) return "";
  const root = domain.split(".").slice(-2)[0] ?? "";
  return root ? root.charAt(0).toUpperCase() + root.slice(1) : "";
}

function field(body: string, label: RegExp): string {
  return (body.match(label)?.[1] ?? "").trim();
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${+m}/${+d}` : iso;
}

/**
 * Build a task name in Last Mile's style: {customer} ({DELIVERY/PICKUP} @ time)
 * or {customer} {m/d}. Customer = the person's name, else the org from domain.
 */
function buildTaskName(
  message: { body: string },
  sender: { name: string; email: string },
  dueOn: string | null,
): string {
  const who =
    sender.name?.trim() ||
    orgFromDomain(sender.email) ||
    sender.email?.split("@")[0] ||
    "New inquiry";

  const delivery = field(message.body, /Pick ?up or Delivery\s*[:\n]+\s*([A-Za-z ]+)/i);
  const time = field(message.body, /\bTime\s*[:\n]+\s*([^\n]+)/i);

  let descriptor = "";
  if (delivery && time) descriptor = `(${delivery.toUpperCase()} @ ${time})`;
  else if (delivery) descriptor = `(${delivery.toUpperCase()})`;
  else if (dueOn) descriptor = shortDate(dueOn);

  return descriptor ? `${who} ${descriptor}` : who;
}

function parseEventDate(body: string): string | null {
  const m = body.match(/(?:Event Date|Date(?: needed)?)\s*[:\n]+\s*(.+)/i);
  if (!m) return null;
  const d = new Date(m[1].trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** The cleaned email content used for both task notes and task comments. */
export function buildNotes(message: {
  subject: string;
  body: string;
  from: string;
}): string {
  const isSquare = /New Form Entry/i.test(message.subject);
  return isSquare
    ? cleanFormNotes(message.body)
    : `From: ${message.from}\nSubject: ${message.subject}\n\n${trimQuoted(message.body)}`;
}

export function buildTaskDraft(
  message: { subject: string; body: string; from: string },
  sender: { name: string; email: string },
): TaskDraft {
  const isSquare = /New Form Entry/i.test(message.subject);
  const section = guessSection(`${message.subject}\n${message.body}`);
  const dueOn = isSquare ? parseEventDate(message.body) : null;
  const name = buildTaskName(message, sender, dueOn);

  return { name, section, dueOn, notes: buildNotes(message) };
}
