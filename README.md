# Dara — Real Estate CRM & Revenue Operations (Release 1 prototype)

Dara is a multi-tenant SaaS CRM for Dubai brokerages. It connects leads, listings, projects, reservations, deals and the people working them. It has a public landing page with role-based sign-in, a main dashboard everyone sees, and a personal dashboard for each member that reports to management. It also includes team control, task assignment with manager review, calendars and meeting tracking, time insights, real-time team chat, a leaderboard with achievements, and administration.

**No npm dependencies.** It runs on Node.js's built-in HTTP server and SQLite.

## Run it

Requirements: **Node.js 22.13 or newer** (`node --version`). Get it from https://nodejs.org (LTS).

```bash
npm start            # http://localhost:4310 — creates ./data/dara.db and loads synthetic demo data on first run
npm test             # 95 automated tests (unit + API + SaaS/reservations + migrations)
npm run seed         # wipe the database and reload fresh demo data (dates relative to today)
```

On Windows you can also double-click **`start-windows.bat`**.

**Upgrading from the first version?** Your existing `data/dara.db` migrates automatically on start. To see the new demo projects, reservations and second brokerage, run `npm run seed` once. This wipes the demo database and reloads it.

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

## What's inside
- **Main dashboard (everyone):** company KPIs with change vs the previous period, an activity trend, closed volume, pipeline by stage, top performers, recent wins, announcements and your agenda for the day. Period switch: today, week, month, quarter, year.
- **My dashboard / member dashboards:** KPIs, points trend, monthly goals (set by management), open tasks, upcoming events, points ledger and achievements. Management and team leads open any member's dashboard within their scope.
- **Team control:** each member's points, closed volume, viewings, calls, approved and overdue tasks, items awaiting review, pipeline and online status. Columns are sortable.
- **Leads:** capture, self/manual/round-robin assignment with history, status rules (a reason is required to disqualify), and explainable matching against verified inventory.
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
- **Arabic (RTL)** toggle in the user menu (draft translation).

## Project layout
```
server/   HTTP pipeline, auth, RBAC, routes, domain services, migrations, seed
public/   landing page + workspace SPA (vanilla ES modules, SVG charts)
tests/    node:test unit + API + migration tests
scripts/  dev helpers: e2e.mjs (Playwright browser flows), screens.mjs (screenshots)
docs/     master-prompt state files: SCOPE, DECISIONS, ASSUMPTIONS, QUESTIONS, CAPABILITIES, METRICS, RISKS, CHANGELOG
```

## Configuration
Copy `.env.example` to `.env` to change `PORT`, `DB_FILE`, session lifetime or demo seeding. Set `NODE_ENV=production` only behind HTTPS, so cookies are marked Secure.

## Honest status
This is a working prototype on **synthetic data**, verified locally (see `docs/CAPABILITIES.md`). It is **not** production-ready. Before selling it needs:
- **Postgres with row-level security** — the multi-tenant isolation is currently enforced in application code only
- An identity provider with MFA, and email verification on signup
- A payment provider and confirmed pricing
- A hosting region and data-protection decision
- A backup/restore drill, an accessibility audit and a native-speaker Arabic review
- Counsel's confirmation of every UAE regulatory item The blocking product decisions are in `docs/QUESTIONS.md`.
