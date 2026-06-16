/**
 * Durable match feedback — the app's memory of which Asana task belongs to
 * which customer, learned from the user's "✓ Correct" / "✗ Not this task"
 * corrections. Lives in KV (Upstash); when KV isn't configured every function
 * degrades to a no-op so the UI still works, it just doesn't get smarter.
 *
 * Keyed on the CUSTOMER's email. Internal/teammate senders (our own domain)
 * never become a key — otherwise one rejection would taint every internal mail.
 */

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import type { MatchMemory } from "./match";

const rejectKey = (email: string) => `learn:reject:${email.toLowerCase()}`;
const confirmKey = (email: string) => `learn:confirm:${email.toLowerCase()}`;

interface ConfirmRecord {
  gids: string[];
  section?: string;
  at: number;
}

/**
 * The customer's email, or null when we shouldn't key learning on this sender
 * (internal teammate, or no usable address). Both the matcher and the feedback
 * endpoint derive the key the same way so they always agree.
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

/** Load everything learned for a customer (empty when KV is off or key null). */
export async function loadMatchMemory(
  customerKey: string | null,
): Promise<MatchMemory | undefined> {
  if (!customerKey || !kvConfigured()) return undefined;
  const [rejected, confirm] = await Promise.all([
    kvGetJSON<string[]>(rejectKey(customerKey)),
    kvGetJSON<ConfirmRecord>(confirmKey(customerKey)),
  ]);
  return {
    rejectedGids: rejected ?? [],
    confirmedGids: confirm?.gids ?? [],
    preferredSection: confirm?.section,
  };
}

/** Remember that `taskGid` is NOT the right task for this customer. */
export async function recordReject(customerKey: string, taskGid: string): Promise<void> {
  if (!kvConfigured()) return;
  const key = rejectKey(customerKey);
  const cur = (await kvGetJSON<string[]>(key)) ?? [];
  if (!cur.includes(taskGid)) cur.push(taskGid);
  await kvSetJSON(key, cur.slice(-50));
}

/** Remember that `taskGid` IS the right task for this customer (+ its section). */
export async function recordConfirm(
  customerKey: string,
  taskGid: string,
  section?: string,
  now = Date.now(),
): Promise<void> {
  if (!kvConfigured()) return;
  const key = confirmKey(customerKey);
  const cur = (await kvGetJSON<ConfirmRecord>(key)) ?? { gids: [], at: 0 };
  if (!cur.gids.includes(taskGid)) cur.gids.push(taskGid);
  cur.gids = cur.gids.slice(-20);
  if (section) cur.section = section;
  cur.at = now;
  await kvSetJSON(key, cur);

  // A confirmation overrides any earlier rejection of the same task.
  const rkey = rejectKey(customerKey);
  const rej = (await kvGetJSON<string[]>(rkey)) ?? [];
  if (rej.includes(taskGid)) {
    await kvSetJSON(rkey, rej.filter((g) => g !== taskGid));
  }
}
