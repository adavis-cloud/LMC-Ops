# Last Mile Connector

**Live:** https://lmc-ops-tawny.vercel.app

An internal operations dashboard for Last Mile Cafe — sign in with Google,
triage inbound inquiries, and connect them to your Asana workflow.

## What it does

- **Google sign-in**, locked to the `lastmile.cafe` domain (fails closed).
- **Inbox triage** with one-click filters — **Catering · Wholesale · Square
  forms · Bills · Urgent** (Urgent is scored and ranked with "why" tags), plus
  free-text **Search** and **Show all**.
- **Open any email** to read the full body, then:
  - **Asana match check** — finds a corresponding task (by customer email, org
    domain, or name in the notes) with **confidence**, the task's **section**,
    and a **Done** badge.
  - **Actions** — mark as read, flag, a review-only reply draft, and a
    note-to-self (recipient hard-locked to you).
  - **Create an Asana task** — pre-filled name, guessed section, due date, and
    matching notes; duplicate-guarded; nothing creates until you confirm.
- **Asana panel** — your **My tasks** and the **Outgoing Activity** project.
- **Slack panel** — see below.

## Slack → Asana

Turn Slack messages into Asana tasks/comments without leaving Slack, and review
what was done back in the web app.

- On any Slack message: **⋯ More actions → Create Asana task** opens a modal
  pre-filled with a task name, an **assignee** (guessed from who you @mention or
  the message's author, via a Slack→Asana roster you set up), and a **due date**
  parsed from phrases like "tonight" or "by Friday". Confirm and it's created in
  *Outgoing Activity*, assigned, with the due date driving Asana's reminder.
- **⋯ → Add comment to Asana task** logs a note on an existing task.
- `/task order more bags by friday` starts a task from scratch.
- The **Slack panel** in the web app shows connection status, the roster editor,
  and a **Recent Slack actions** feed.

The bot only sees a message's text when you invoke a shortcut on it — it does
not read your channels, and normal Slack replies are untouched.

**Setup:** see [SLACK-SETUP.md](SLACK-SETUP.md) (an Upstash/Vercel KV store plus
a Slack app with two message shortcuts).

## Stack & ops

Next.js 16 + React 19 + Tailwind v4, Auth.js v5 (Google), Gmail + Asana + Slack
via REST, Upstash Redis (KV) for Slack automation state. Deployed on **Vercel**,
Git-connected — every push to `main` auto-deploys.

## Getting started

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in the values. See `SETUP-GOOGLE-OAUTH.md`,
`ASANA-SETUP.md`, and `SLACK-SETUP.md` for the per-integration steps.

Open [http://localhost:3000](http://localhost:3000).
