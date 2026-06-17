# Last Mile Connector — Status & Handoff

_Internal ops dashboard for Last Mile Cafe. This file is **gitignored on purpose**
(the repo is public + auto-commits to `main`; a vulnerability list shouldn't ship publicly)._

- **Live:** https://lmc-ops-tawny.vercel.app
- **Repo:** https://github.com/adavis-cloud/LMC-Ops (public)
- **Stack:** Next.js 16 + React 19 + Tailwind v4, Auth.js v5 (Google), Gmail + Asana
  via REST, Upstash Redis (KV). Hosted on Vercel (project `lmc-ops`, Git-connected
  auto-deploy). Slack integration in progress.

---

## Features built

**Auth & access**
- Google sign-in, locked to the `lastmile.cafe` domain; **fails closed** (no allow-list → nobody in).

**Inbox triage**
- Gmail search; **Show all** (latest inbox).
- Filter chips: **Catering · Wholesale · Square forms · Bills · Urgent**.
  - Urgent is **scored & ranked** (keywords, dates, follow-ups, unread/important/starred, sender type, recency) with "why" tags.
- **Read/Unread status** toggle using Gmail's `is:read`/`is:unread`; unread rows bold + dot.
- Click an email → **full body view**.

**Asana matching (read)**
- Each opened email is checked against your Asana tasks (My tasks + Outgoing Activity, incl. completed).
- Match shown with **confidence** (high/med/low/none), the **section** (Wholesale/Catering/…), and a **Done** badge.
- Matching signals: exact customer email, org-from-domain, business name, greeting recipient ("Hi Gaby"), subject phrases, sender name.
- **Learning:** ✓ Correct / "Not the right task" corrections persist in KV and improve future matches (keyed by email / domain / org-name).

**Email actions (Gmail write — self-only sends)**
- Mark as read, Flag (star).
- **Reply draft** — review-only template, never sent.
- **Note to self** — emails *only* the signed-in user (recipient hard-locked; refuses any other address).

**Asana writes**
- **Create task** from an email: pre-filled name, guessed section, due date, and notes that mirror existing Square-form tasks; duplicate-guarded; confirm-before-create.
- **Add email to matched task** as a comment ("Update").

**Other**
- Centralized email parser (`lib/parse.ts`) — single source for naming/section/notes/matching.
- Asana on its own page `/asana` (opens in a new window); views: My tasks + Outgoing Activity.

---

## Actions taken (setup / infra)
- Installed **pnpm** (standalone) — npm wasn't present on the machine.
- Scaffolded the Next.js app; fixed a pnpm CI build quirk (`verifyDepsBeforeRun: false`).
- Created the **GitHub repo** + **Vercel project**, set env vars, deployed; wired Git auto-deploy.
- Registered the **Google OAuth** client and **Asana OAuth** app; upgraded scopes (Gmail `gmail.modify`; Asana `tasks:write`).
- Connected **Upstash Redis (KV)** via Vercel Marketplace (match-learning + Slack storage).

---

## ⚠️ Vulnerabilities & security risks

| # | Risk | Severity | Notes / mitigation |
|---|------|----------|--------------------|
| 1 | **Public repo + auto-commit to `main`** | High | An external process commits *all* changes and pushes publicly. If a secret ever lands in a tracked file it's exposed instantly. Keep secrets only in `.env.local` / Vercel; consider a pre-commit secret scan. `.env*` and the setup/handoff docs are gitignored — keep it that way. |
| 2 | **Asana tokens stored in KV** (`asana-store.ts`) | Med–High | Access + refresh tokens are mirrored to KV (so Slack automation can use them without a cookie). They appear to be stored as **plain JSON**. Recommend **encrypting tokens at rest** and ensuring KV keys aren't guessable. An Asana token grants read+write to the whole workspace. |
| 3 | **Secrets shared during setup** | Med | Google & Asana client secrets were pasted in chat and live in `.env.local` + Vercel. Fine if never committed — but **rotate them** if there's any chance `.env.local` was exposed. |
| 4 | **Broad Gmail scope (`gmail.modify`)** | Med | Token can read/modify/send all mail; the app only uses a subset and **locks sends to self in code**. The self-send guard is a code control, not a scope limit — if the token leaks, more is possible. |
| 5 | **Slack endpoints (in progress)** | Med | Before Slack goes live, **enforce request-signature verification** (`SLACK_SIGNING_SECRET`) on every Slack webhook/route, or anyone could POST to them. Verify this is implemented. |
| 6 | **Client-controlled writes to KV** (`/api/asana/match-feedback`) | Low | Authenticated users send `keys[]`/`taskGid` that get written to KV. Only domain-allow-listed users can reach it, and entries are capped — but it's user input → storage. |
| 7 | **Custom POST routes & CSRF** | Low | State-changing routes rely on the session cookie (SameSite=Lax) rather than explicit CSRF tokens. Same-origin JSON fetch limits exposure; revisit if routes ever accept form posts. |
| 8 | **Error logging** | Low | `console.error` logs upstream error bodies (Asana/Gmail) which could include request data. Vercel logs are private; avoid logging tokens/PII. |

_No critical "anyone can read your mail" hole found: API routes require an allow-listed Google session, and the public surface is just the sign-in page._

---

## Important notes / gotchas
- **AI intentionally not used** for reply drafts / task names (no Anthropic key). Good task names depend on the **planned Square form fields** (Business name + Occasion) — see Next steps.
- **Toolchain:** npm/vercel binaries are broken symlinks on this machine. Use **pnpm** (`~/Library/pnpm/bin`), run Next via `./node_modules/.bin/next`, Vercel via `pnpm dlx vercel@latest`, and `gh auth setup-git` for pushes.
- **KV is configured** (Upstash, all Vercel envs + `.env.local`) — match-learning now actually persists.

## Pending manual steps (in your accounts)
- **Google:** confirm `https://lmc-ops-tawny.vercel.app/api/auth/callback/google` is an Authorized redirect URI (for live sign-in).
- **Asana:** confirm enabled scopes include `users:read, projects:read, tasks:read, tasks:write`, and that you've reconnected since adding `tasks:write`.
- **Square form:** add **Business / Organization name** and **Occasion / Event type** fields → unlocks accurate, on-style task names automatically.

## Next steps
1. Add the Square form fields above (biggest quality win for task naming/matching).
2. Finish + secure the **Slack** integration (signature verification first).
3. **Encrypt Asana tokens at rest** in KV (risk #2).
4. Add a **pre-commit secret scan** given the public auto-committed repo (risk #1).
5. Nice-to-haves: auto-refresh the list after marking an email read; a "learned from a past correction" indicator on matches; keep tuning matching with real examples.
