# Dara — Real Estate CRM & Revenue Operations (Release 1 prototype)

Dara is a multi-tenant SaaS CRM for Dubai brokerages. It connects leads, listings, projects, reservations, deals and the people working them. It has a public landing page with role-based sign-in, a main dashboard everyone sees, and a personal dashboard for each member that reports to management. It also includes team control, task assignment with manager review, calendars and meeting tracking, time insights, real-time team chat, a leaderboard with achievements, and administration.

**No runtime dependencies for local use.** It runs on Node.js's built-in HTTP server and SQLite. For production it runs on **PostgreSQL with row-level security** (the optional `pg` driver is the only runtime package).

## Run it

### Public link on Render (app + PostgreSQL)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/morsiali/Dara--Real-estate-CRM-platform)

Click the button (or go to Render → **New → Blueprint** and pick this repository), then click **Apply**. Render reads `render.yaml`, creates the PostgreSQL 16 database and the web service, generates `DARA_SECRET_KEY`, and loads the synthetic demo. The first build takes about 5 minutes. Your link is `https://dara-crm.onrender.com`, or a variant if that name is taken.
- Free plans are for evaluation only: the app sleeps after 15 minutes idle (about a minute to wake) and the free database is deleted after 30 days. Upgrade both in the dashboard for real use.
- No real emails are sent yet, so **forgot password does not deliver a link on Render**. The new-workspace verification link is shown on screen to its owner.
- Demo accounts use a public password. Anyone with the link can sign in to the demo workspace, so don't put real client data in it.

### Live in your browser (GitHub Codespaces)
On the repository page: **Code → Codespaces → Create codespace on main**. It installs, seeds the synthetic demo and opens Dara on port 4310 (about 2 minutes the first time). To share the link with someone, open the **Ports** tab, right-click port 4310 → **Port visibility → Public**. The codespace stops when idle; reopening it restarts the app.

### On your computer

Requirements: **Node.js 22.13 or newer** (`node --version`). Get it from https://nodejs.org (LTS).

```bash
npm start            # http://localhost:4310 — creates ./data/dara.db and loads synthetic demo data on first run
npm install          # once — adds the Postgres driver and the in-process Postgres used by tests (optional for SQLite-only use)
npm test             # automated tests on SQLite
npm run test:pg      # the same suites + row-level-security tests on in-process PostgreSQL
npm run seed         # wipe the database and reload fresh demo data (dates relative to today)
```

### Run on PostgreSQL (production setup) with Docker
```bash
cp .env.example .env     # then set POSTGRES_PASSWORD, DARA_DB_PASSWORD and DARA_SECRET_KEY (openssl rand -base64 32)
docker compose up --build
```
Open http://localhost:4310. The stack has the app plus PostgreSQL 16. The app connects as a non-superuser and every request runs inside the tenant's row-level-security context. The compose file loads the synthetic demo by default (`SEED_ON_EMPTY=1`) and shows email links on screen (`DEV_LINKS=1`); set both to `0` for anything except a private demo.

Without Docker: point `DATABASE_URL` at your Postgres. Use a **non-superuser** role — superusers bypass row-level security. `docker/initdb.sh` shows the roles to create.

On Windows you can also double-click **`start-windows.bat`**.

**Upgrading?** Your existing `data/dara.db` migrates automatically on start, and existing accounts are marked as email-verified. To see the new demo projects, reservations and second brokerage, run `npm run seed` once. This wipes the demo database and reloads it.

### Demo sign-ins (synthetic data)
Every account's password is `DaraDemo2026`.

| Role | Email | What they get |
|---|---|---|
| Manager (Sales Director) | `manager@dara.demo` | Everything company-wide: team control, review queue, goals, announcements, time insights, people, audit |
| Team lead | `lead@dara.demo` | Their team's leads, deals, calendars and tasks; round-robin; reviews |
| Agent | `agent@dara.demo` | Own leads, matches, pipeline, tasks, calendar, goals, points |
| Administrator | `admin@dara.demo` | People and teams, roles, workspace and compliance, data export, audit log, all records |
| Dara platform staff | `platform@dara.demo` | Platform console only: every brokerage's plan, usage and status; no access to brokerage data |
| Second brokerage (trial) | `owner@palmcoast.demo` | A separate, isolated workspace on a trial plan |

Other demo agents: karim, priya, yousef, elena, hassan, and team lead daniel — all `@dara.demo`.

Demo workspaces don't force two-step sign-in, so you can click straight in. **New workspaces created from "Start a trial" do**: the owner confirms their email and sets up an authenticator app before entering. No real emails are sent — they're written to `data/outbox/`, and in development the link is also shown on screen.

## What's inside
- **Main dashboard (everyone):** company KPIs with change vs the previous period, an activity trend, closed volume, pipeline by stage, top performers, recent wins, announcements and your agenda for the day. Period switch: today, week, month, quarter, year.
- **My dashboard / member dashboards:** KPIs, points trend, monthly goals (set by management), open tasks, upcoming events, points ledger and achievements. Management and team leads open any member's dashboard within their scope.
- **Team control:** each member's points, closed volume, viewings, calls, approved and overdue tasks, items awaiting review, pipeline and online status. Columns are sortable.
- **Leads:** capture, self/manual/round-robin assignment with history, status rules (a reason is required to disqualify), and explainable matching against verified inventory.
- **AI follow-up desk:** ranks untouched and stale leads, then prepares a next step, an editable client message and a task for a selected lead. It never sends a message or changes a record on its own. The user reviews the task before creating it.
- **Pipeline:** drag-and-drop kanban. Winning requires a linked listing and a value. Losing requires a reason. Only management reopens a closed deal, and must give a reason.
- **Listings:** inventory authority (platform / external / unverified), availability confidence, verification and permit number.
- **Tasks:** assign → start → submit with a note → approve or request changes. Points are awarded on approval, with an on-time bonus.
- **Calendar:** week and month views, invites, RSVP, double-booking detection, outcomes and no-shows.
- **Time insights:** hours by event type per person, client vs internal share, double bookings, and client hours per won deal.
- **Team chat:** company, team and direct messages in real time (Server-Sent Events). @mentions notify. Wins and achievements post automatically.
- **Leaderboard:** podium, standings, transparent point rules (activity capped at 30 a day) and recent achievements.
- **Administration:** people and teams, a permission matrix shown in plain language, and an audit log.
- **SaaS:** brokerages sign up from the landing page and get a 14-day trial with 5 users. Plan limits on users and listings are enforced on the server. A workspace becomes read-only when its trial ends or it's suspended. Admins can export all data as JSON at any time. Dara staff manage subscriptions from the platform console. Plans are *proposed*; no payments are taken.
- **Projects:** each project decides who controls availability ("we do" vs "the developer does"), and its listings follow that setting.
- **Reservations:** hold → submit deposit → management confirms with a developer reference. Holds last 48 hours, with one renewal. The database blocks two active holds on one unit. Developer-controlled holds are labelled "Internal hold — not confirmed with developer".
- **Dubai compliance tracking:** trade licence, RERA ORN, agent BRN and advertising permits, with expiry reminders. These are tracked only; all requirements are to be verified with counsel.
- **Sign-in security:** two-step sign-in with an authenticator app (QR code or setup key) and 8 one-time recovery codes. It is required for administrators of new workspaces (a workspace switch). Also: email verification at signup, forgot/reset password by email link, and an admin "Reset two-step sign-in" for lost phones. Two-step secrets are encrypted at rest.
- **Compliance switches (off by default):** block holds and new leads for agents with an expired broker card; block holds on listings with an expired advertising permit.
- **Tenant isolation in the database:** on PostgreSQL, every table has forced row-level security, so a query without a tenant filter still returns only that brokerage's rows.
- **Arabic (RTL)** toggle in the user menu (draft translation).

## Project layout
```
server/   HTTP pipeline, auth, RBAC, routes, domain services, migrations, seed
public/   landing page + workspace SPA (vanilla ES modules, SVG charts)
tests/    node:test unit + API + security + RLS + migration tests (SQLite and PGlite)
scripts/  e2e.mjs (Playwright browser flows), screens.mjs (screenshots), test-pg.mjs, check-awaits.mjs
docker/   initdb.sh — Postgres roles (non-superuser owner + app role)
docs/     master-prompt state files: SCOPE, DECISIONS, ASSUMPTIONS, QUESTIONS, CAPABILITIES, METRICS, RISKS, CHANGELOG
```

## Configuration
Copy `.env.example` to `.env`. Every setting is explained there. Main ones:
- `DATABASE_URL` switches to PostgreSQL.
- `DARA_SECRET_KEY` is required in production; it encrypts two-step secrets.
- `PUBLIC_URL` is the base for emailed links.
- `NODE_ENV=production` turns on Secure cookies and turns off the demo seed and on-screen email links.
- `OPENAI_API_KEY` enables the AI follow-up desk. For local use, place it in ignored `.env.local`; for Render, add it as a secret environment variable on the `dara-crm` web service and redeploy. Do not put a key in Git or client-side code. The default model is `gpt-6-luna` (override with `OPENAI_AI_MODEL`).

The follow-up queue works without a key. Clicking **Prepare follow-up** sends the selected lead's first name, requirements, notes, recent activity, open tasks and up to three verified listing matches to OpenAI. Email addresses and phone numbers are not included as separate fields. The API request sets `store: false`. Plans are limited to 30 successful generations per user per rolling day and are recorded in the audit log. Review the draft and verify listing facts before contacting a client.

## Honest status
This is a working product on **synthetic data**, verified locally and against a real PostgreSQL 16 server (see `docs/CAPABILITIES.md`). Before selling it still needs:
- **A mail provider** for real email delivery (currently a local outbox), and optionally Microsoft/Google single sign-on
- **Pricing and a payment provider** (plans are proposed; no payments are taken)
- **A hosting region and data-protection decision** (UAE region? PDPL / DIFC / ADGM)
- A first `docker compose up` on your machine (the image wasn't built in my environment), a backup/restore drill, an accessibility audit and a native-speaker Arabic review
- Counsel's confirmation of every UAE regulatory item

The open product decisions are in `docs/QUESTIONS.md`.
