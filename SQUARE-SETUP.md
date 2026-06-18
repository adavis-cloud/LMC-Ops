# Square integration setup

The Square panel does two things when you open an email:

1. **Cross-checks for an existing invoice** for that customer (by email) and
   shows its status / amount / link — right next to the Asana match.
2. Lets you **prepare a DRAFT invoice** in Square. The app never publishes or
   sends — it creates a draft and links you into Square, where you set the
   amounts/line items and send it yourself.

Do this once, then add the env vars to `.env.local` **and** Vercel.

> **Start in Sandbox.** `SQUARE_ENV=sandbox` (the default) points at Square's
> test environment — fake invoices, no real money. Switch to `production` only
> after you've confirmed the flow end-to-end.

## 1. Create a Square app

At **developer.squareup.com/apps → +** create an application.

You'll work with two credential sets on the app's **OAuth** page:
- **Sandbox** Application ID + Application Secret (use these first).
- **Production** Application ID + Application Secret (use later to go live).

## 2. Set the OAuth redirect URL

On the app's **OAuth** page, set the Redirect URL to match the environment:

- Production site: `https://lmc-ops-tawny.vercel.app/api/square/callback`
- Local dev: `http://localhost:3000/api/square/callback`

Square allows one redirect URL per environment (Sandbox vs Production), so set
the one that matches where you're testing.

## 3. Scopes

The app requests these automatically (see `lib/square.ts`); make sure they're
permitted on your Square app:

```
MERCHANT_PROFILE_READ
CUSTOMERS_READ  CUSTOMERS_WRITE
INVOICES_READ   INVOICES_WRITE
ORDERS_READ     ORDERS_WRITE
```

`*_WRITE` is needed only to create the **draft** (customer + order + draft
invoice). We never call the publish/send endpoint.

## 4. Env vars

Add to `.env.local` (local) and the Vercel project settings (prod):

```
SQUARE_ENV=sandbox            # "production" when you're ready to go live
SQUARE_CLIENT_ID=...          # Application ID (matching the environment)
SQUARE_CLIENT_SECRET=...      # Application Secret (matching the environment)
```

The Square access token itself is **not** an env var — it's obtained per-user
via OAuth and stored in an httpOnly cookie (refreshed automatically).

## 5. Connect

Open the Connector, open any email, and click **Connect Square** in the Square
panel. Authorize with a Square account (a Sandbox **test account** while in
sandbox — create one under the app's Sandbox **Test Accounts**).

## Going live (later)

1. Complete Square's production authorization requirements for your app.
2. Swap the env vars to the **Production** Application ID/Secret and set
   `SQUARE_ENV=production`.
3. Set the production Redirect URL on the app.
4. Disconnect + reconnect Square in the Connector so the token is for the live
   merchant.

## Notes / gotchas

- **Cross-check is by customer email.** It finds the Square customer whose email
  matches the email's sender/customer, then lists their invoices. Customers with
  no email in Square, or a different email than the inbound message, won't match.
- **Drafts include a placeholder line item.** Square requires a non-empty order,
  so the draft starts with one line item named after the email subject — edit it
  (and add the real amount) in Square before sending.
- **Unverified against a live account at build time.** The flow is written to
  Square's documented API but was shipped without a real Square account to test
  against — expect to iron out the occasional field on first real connect.
