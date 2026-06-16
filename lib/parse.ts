/**
 * Single source of truth for turning a Gmail message into a normalized inquiry.
 * Everything else (task name, section guess, matching, notes) reads from this.
 *
 * Square form emails are label/value pairs (label on one line, value on the
 * next), so we parse them deterministically. Direct emails fall back to header
 * + body. Labels support aliases so the form wording can change safely.
 */

export interface ParsedInquiry {
  source: "square" | "email";
  subject: string;
  contactName: string;
  email: string;
  phone: string;
  business: string;
  occasion: string;
  eventDate: string | null; // ISO yyyy-mm-dd
  time: string;
  fulfillment: string; // Pickup / Delivery
  address: string;
  message: string;
  /** Cleaned content for task notes / comments (footer stripped). */
  notes: string;
}

const FOOTER_MARKERS = [
  "Email to Last Mile Cafe",
  "Reply via Square",
  "Or reply directly to this email",
  "Manage Your Preferences",
  "Privacy Policy",
  "1955 Broadway",
];

const FIELD_ALIASES: Record<string, string[]> = {
  contactName: ["full name", "name", "your name", "contact name"],
  email: ["email", "email address"],
  phone: ["phone number", "phone", "telephone", "cell"],
  business: [
    "business name", "business / organization name", "business/organization name",
    "organization", "organisation", "organization name", "company", "company name",
    "business", "org",
  ],
  occasion: [
    "occasion", "what's the occasion", "what is the occasion", "event type",
    "type of event", "what is this for", "what's this for", "reason", "purpose",
    "event name",
  ],
  eventDate: ["event date", "date", "date needed", "date of event"],
  time: ["time"],
  fulfillment: ["pick up or delivery", "pickup or delivery", "pickup/delivery", "pick-up or delivery"],
  address: ["address", "delivery address"],
  message: ["message", "comments", "comment", "additional details", "details", "notes", "anything else"],
};

// label string -> canonical field
const LABEL_TO_FIELD: Record<string, string> = {};
for (const [field, labels] of Object.entries(FIELD_ALIASES)) {
  for (const l of labels) LABEL_TO_FIELD[l] = field;
}

function cleanBody(body: string): string {
  let text = body.replace(/\r/g, "");
  let cut = text.length;
  for (const m of FOOTER_MARKERS) {
    const i = text.indexOf(m);
    if (i !== -1 && i < cut) cut = i;
  }
  text = text.slice(0, cut);
  text = text.replace(/^.*New Form Entry from[^\n]*\n/i, "");
  return text.trim().replace(/\n{3,}/g, "\n\n");
}

function parseEventDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Walk label/value lines and collect known fields. */
function parseFields(cleaned: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = cleaned.split("\n");
  let current: string | null = null;
  for (const line of lines) {
    const key = line.trim().toLowerCase().replace(/[:?]+$/, "");
    if (LABEL_TO_FIELD[key]) {
      current = LABEL_TO_FIELD[key];
      out[current] = "";
    } else if (current) {
      out[current] = (out[current] ? out[current] + "\n" : "") + line;
    }
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

function parseFromHeader(from: string): { name: string; email: string } {
  const email =
    from.match(/<([^>]+@[^>]+)>/)?.[1] ??
    from.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ??
    "";
  const name = (from.split("<")[0] ?? "")
    .replace(/"/g, "")
    .replace(/\s+via\s+\S+.*$/i, "")
    .trim();
  return { name, email };
}

export function parseInquiry(message: {
  subject: string;
  body: string;
  from: string;
}): ParsedInquiry {
  const cleaned = cleanBody(message.body);
  const isSquare = /New Form Entry/i.test(message.subject);

  if (isSquare) {
    const f = parseFields(cleaned);
    // The subject also carries the customer email: "New Form Entry from X: ..."
    const subjEmail = message.subject.match(
      /New Form Entry from\s+([\w.+-]+@[\w.-]+\.\w+)/i,
    )?.[1];
    return {
      source: "square",
      subject: message.subject,
      contactName: f.contactName ?? "",
      email: (f.email || subjEmail || "").trim(),
      phone: f.phone ?? "",
      business: f.business ?? "",
      occasion: f.occasion ?? "",
      eventDate: parseEventDate(f.eventDate ?? ""),
      time: f.time ?? "",
      fulfillment: f.fulfillment ?? "",
      address: f.address ?? "",
      message: f.message ?? "",
      notes: cleaned,
    };
  }

  const { name, email } = parseFromHeader(message.from);
  return {
    source: "email",
    subject: message.subject,
    contactName: name,
    email,
    phone: "",
    business: "",
    occasion: "",
    eventDate: null,
    time: "",
    fulfillment: "",
    address: "",
    message: cleaned,
    notes: `From: ${message.from}\nSubject: ${message.subject}\n\n${cleaned}`,
  };
}
