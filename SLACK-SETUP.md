# Slack integration setup

The Slack panel turns Slack messages into Asana tasks/comments and shows a
feed of what was done. It needs (1) a small datastore and (2) a Slack app.
Do these once, then add the env vars to `.env.local` **and** Vercel.

## 1. Storage (Upstash Redis / Vercel KV)

Background Slack actions arrive as server-to-server webhooks with no browser
cookie, so tokens + the activity log live in a KV store instead.

**Easiest (Vercel):** Vercel dashboard → **Storage** → create an **Upstash KV**
(Redis) database and link it to the project. Vercel injects `KV_REST_API_URL`
and `KV_REST_API_TOKEN` automatically — pull them locally with the Vercel CLI
or copy into `.env.local`.

**Or directly via Upstash:** create a free database at upstash.com → copy the
**REST URL** and **REST token** into:

```
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

## 2. Asana write scope

Task creation needs `tasks:write` on your Asana app (it's already requested in
`lib/asana.ts`). On app.asana.com confirm the scope is enabled, then **reconnect
Asana** in the Connector so the token is current. Visiting the Asana page once
while connected mirrors the token into KV automatically; you can also click
**Link Asana** on the Slack page.

## 3. Slack app

At **api.slack.com/apps → Create New App → From scratch**, pick your workspace.

**OAuth & Permissions**
- Redirect URL: `https://YOUR-DOMAIN/api/slack/callback`
  (and `http://localhost:3000/api/slack/callback` for local dev)
- Bot Token Scopes: `commands`, `chat:write`, `users:read`, `users:read.email`

**Interactivity & Shortcuts** → turn **On**
- Request URL: `https://YOUR-DOMAIN/api/slack/interactivity`
- Create two **Message** shortcuts:
  | Name | Callback ID |
  | --- | --- |
  | Create Asana task | `create_asana_task` |
  | Comment on Asana task | `comment_asana_task` |

**Slash Commands** (optional) → Create `/task`
- Request URL: `https://YOUR-DOMAIN/api/slack/commands`
- Short description: "Create an Asana task"

**Basic Information** → copy **Client ID**, **Client Secret**, and
**Signing Secret** into:

```
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
```

Then **Install to Workspace**.

## 4. Connect & map people

1. Open the Connector → **Slack ↗**.
2. Click **Connect Slack** and approve.
3. Make sure **Asana automation** shows *Linked* (click **Link Asana** if not).
4. Under **People (Slack → Asana)**, click **Load people** and map each Slack
   teammate to their Asana user, then **Save mapping**. This is how tasks get
   assigned to "the appropriate person."

## Using it

- On any Slack message: **⋯ More actions → Create Asana task**. A modal opens
  pre-filled with a task name, a guessed assignee (whoever you @mention, else
  the message's author), and a due date guessed from words like "tonight" or
  "by Friday." Adjust and hit **Create**.
- **⋯ → Add comment to Asana task** logs a note on an existing task.
- `/task <text>` starts a task from scratch.

Every action posts you a confirmation DM and appears under **Recent Slack
actions** in the web app. Due dates drive Asana's own reminders to the assignee.

## Notes / limits

- The bot only sees a message's text when *you* invoke a shortcut on it — it
  does **not** read your channels. Replying normally in Slack is untouched.
- Due-date guessing is heuristic (no AI) and uses the server's clock; always
  confirm the date in the modal.
- The task picker for comments lists open tasks in **Outgoing Activity**
  (up to 100).
