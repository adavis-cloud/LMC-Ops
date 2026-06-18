/**
 * Minimal Square client: OAuth token exchange/refresh, invoice lookup, and
 * DRAFT invoice preparation. We never PUBLISH/SEND — drafts are created in
 * Square and the user finalizes + sends inside Square's own UI.
 * Docs: https://developer.squareup.com/reference/square
 *
 * Environment is chosen by SQUARE_ENV ("sandbox" | "production"); defaults to
 * sandbox so we never touch a live merchant by accident.
 */

const IS_PROD = (process.env.SQUARE_ENV ?? "sandbox").toLowerCase() === "production";
const CONNECT_BASE = IS_PROD
  ? "https://connect.squareup.com"
  : "https://connect.squareupsandbox.com";
const DASHBOARD_BASE = IS_PROD
  ? "https://app.squareup.com"
  : "https://app.squareupsandbox.com";
/** Pin an API version so responses don't shift under us. */
const SQUARE_VERSION = "2025-01-23";

export function squareEnvLabel(): "sandbox" | "production" {
  return IS_PROD ? "production" : "sandbox";
}

/** Scopes — read customers/invoices/orders + write to PREPARE drafts. */
const SCOPES = [
  "MERCHANT_PROFILE_READ",
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
  "INVOICES_READ",
  "INVOICES_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
].join(" ");

export interface SquareToken {
  access_token: string;
  refresh_token?: string;
  /** Absolute expiry time in ms. */
  expires_at: number;
  merchant_id?: string;
}

/** A Square invoice trimmed to what the UI needs. */
export interface InvoiceSummary {
  id: string;
  number?: string;
  status: string; // DRAFT | UNPAID | SCHEDULED | PARTIALLY_PAID | PAID | CANCELED | …
  amount?: string; // formatted, e.g. "$240.00"
  url: string; // public_url when sent, else a dashboard deep-link
}

/** Build the URL we send the user to so they can authorize the app. */
export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL(`${CONNECT_BASE}/oauth2/authorize`);
  u.searchParams.set("client_id", process.env.SQUARE_CLIENT_ID!);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("session", "false");
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", redirectUri);
  return u.toString();
}

interface RawToken {
  access_token: string;
  refresh_token?: string;
  expires_at: string; // RFC3339 timestamp
  merchant_id?: string;
}

function toToken(r: RawToken): SquareToken {
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: Date.parse(r.expires_at) || Date.now() + 29 * 86_400_000,
    merchant_id: r.merchant_id,
  };
}

async function oauthToken(body: Record<string, string>): Promise<SquareToken> {
  const res = await fetch(`${CONNECT_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Square token error: ${JSON.stringify(json)}`);
  return toToken(json as RawToken);
}

export function exchangeCode(code: string, redirectUri: string): Promise<SquareToken> {
  return oauthToken({
    grant_type: "authorization_code",
    client_id: process.env.SQUARE_CLIENT_ID!,
    client_secret: process.env.SQUARE_CLIENT_SECRET!,
    code,
    redirect_uri: redirectUri,
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<SquareToken> {
  const t = await oauthToken({
    grant_type: "refresh_token",
    client_id: process.env.SQUARE_CLIENT_ID!,
    client_secret: process.env.SQUARE_CLIENT_SECRET!,
    refresh_token: refreshToken,
  });
  // Square may omit the refresh token on refresh — keep the old one.
  return { ...t, refresh_token: t.refresh_token ?? refreshToken };
}

async function api<T = any>(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${CONNECT_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Square ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json as T;
}

function money(m?: { amount?: number; currency?: string }): string | undefined {
  if (!m || typeof m.amount !== "number") return undefined;
  // Square amounts are in the smallest currency unit (cents).
  return `$${(m.amount / 100).toFixed(2)}`;
}

/** All active location ids for the merchant (invoices are scoped per-location). */
async function locationIds(token: string): Promise<string[]> {
  const data = await api<{ locations?: { id: string; status?: string }[] }>(
    token,
    "GET",
    "/v2/locations",
  );
  return (data.locations ?? [])
    .filter((l) => l.status !== "INACTIVE")
    .map((l) => l.id);
}

/** Customer ids whose email matches exactly (Square does case-insensitive). */
async function customerIdsByEmail(token: string, email: string): Promise<string[]> {
  const data = await api<{ customers?: { id: string }[] }>(
    token,
    "POST",
    "/v2/customers/search",
    { query: { filter: { email_address: { exact: email } } } },
  );
  return (data.customers ?? []).map((c) => c.id);
}

interface RawInvoice {
  id: string;
  invoice_number?: string;
  status?: string;
  public_url?: string;
  payment_requests?: { computed_amount_money?: { amount?: number; currency?: string } }[];
}

/** Existing invoices for the customer behind this email (empty if none). */
export async function findInvoicesForEmail(
  token: string,
  email: string,
): Promise<InvoiceSummary[]> {
  if (!email) return [];
  const [customers, locations] = await Promise.all([
    customerIdsByEmail(token, email),
    locationIds(token),
  ]);
  if (!customers.length || !locations.length) return [];

  const data = await api<{ invoices?: RawInvoice[] }>(token, "POST", "/v2/invoices/search", {
    query: { filter: { location_ids: locations, customer_ids: customers } },
    limit: 20,
  });

  return (data.invoices ?? []).map((inv) => ({
    id: inv.id,
    number: inv.invoice_number,
    status: inv.status ?? "UNKNOWN",
    amount: money(inv.payment_requests?.[0]?.computed_amount_money),
    url: inv.public_url ?? `${DASHBOARD_BASE}/dashboard/invoices/${inv.id}`,
  }));
}

async function findOrCreateCustomer(
  token: string,
  email: string,
  name: string,
): Promise<string> {
  const existing = await customerIdsByEmail(token, email);
  if (existing.length) return existing[0];
  const [given, ...rest] = name.trim().split(/\s+/);
  const created = await api<{ customer?: { id: string } }>(token, "POST", "/v2/customers", {
    idempotency_key: `lmc-${email}-${Date.now()}`,
    email_address: email,
    given_name: given || undefined,
    family_name: rest.join(" ") || undefined,
  });
  if (!created.customer?.id) throw new Error("Square: could not create customer");
  return created.customer.id;
}

export interface DraftInvoiceResult {
  id: string;
  dashboardUrl: string;
}

/**
 * Create a DRAFT invoice (order + invoice, NOT published). Returns a deep-link
 * to Square so the user can add line items / amounts and send it themselves.
 * A single placeholder line item is added because Square requires a non-empty
 * order; the user edits it in Square.
 */
export async function prepareDraftInvoice(
  token: string,
  args: { email: string; name: string; title: string },
): Promise<DraftInvoiceResult> {
  const [customerId, locations] = await Promise.all([
    findOrCreateCustomer(token, args.email, args.name),
    locationIds(token),
  ]);
  const locationId = locations[0];
  if (!locationId) throw new Error("Square: no active location");

  const order = await api<{ order?: { id: string } }>(token, "POST", "/v2/orders", {
    idempotency_key: `lmc-order-${customerId}-${Date.now()}`,
    order: {
      location_id: locationId,
      customer_id: customerId,
      line_items: [
        { name: args.title.slice(0, 500) || "Order", quantity: "1" },
      ],
    },
  });
  const orderId = order.order?.id;
  if (!orderId) throw new Error("Square: could not create draft order");

  const invoice = await api<{ invoice?: { id: string } }>(token, "POST", "/v2/invoices", {
    idempotency_key: `lmc-inv-${orderId}`,
    invoice: {
      location_id: locationId,
      order_id: orderId,
      primary_recipient: { customer_id: customerId },
      delivery_method: "EMAIL",
      payment_requests: [{ request_type: "BALANCE" }],
      // status stays DRAFT — we deliberately do NOT call /publish.
      title: args.title.slice(0, 50),
    },
  });
  const id = invoice.invoice?.id;
  if (!id) throw new Error("Square: could not create draft invoice");

  return { id, dashboardUrl: `${DASHBOARD_BASE}/dashboard/invoices/${id}` };
}
