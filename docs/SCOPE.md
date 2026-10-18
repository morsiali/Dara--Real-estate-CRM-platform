# Scope — Status: Draft v2 (operator answered Q-01…Q-05 on 2026-10-19) — awaiting formal approval

> The operator asked for a working build directly. Under Master Prompt A8 (fast path) the B1–B3 deliberation was compressed and Release 1 was implemented as a **local prototype on synthetic data**. Approval of this file is still required before any production use, real customer data, or paid services (A5). Irreversible decisions are listed as Blocking in `QUESTIONS.md`.

## Deployment model: Multi-tenant SaaS sold to brokerages (ADR-008, supersedes ADR-001)
Brokerages self-sign-up into isolated workspaces. Dara staff manage subscriptions from a platform console. **Part F is active:** plans, entitlements, trial, read-only suspension and data export. No payment provider is connected (A5). Plan names and limits are *Proposed — unvalidated*.

## Target customer & operations
Dubai brokerages doing **both** secondary/brokerage sales and rentals **and** developer/off-plan sales (Q-02). Roles: Agent → Team lead → Manager, plus Administrator per brokerage, and Platform staff for Dara.

## Jurisdictions / languages / currencies
Dubai, UAE (Q-03) · English + Arabic (RTL, draft translation) · AED (fils minor unit) · Asia/Dubai (UTC+4, no DST). **Part G is active as tracking only:** trade licence, ORN, agent BRN and advertising permit, each with an expiry reminder, plus an Oqood reference on reservations. Every rule stays `[Verify]` and nothing is enforced. Data residency for hosting is open (Q-13).

## Release 1 workflow (end-to-end)
Lead capture → Assignment (self / manual / round-robin) → Requirement → Explainable matching → Viewing (calendar + outcome) → Opportunity pipeline → Outcome (won / lost / nurtured) → Points, leaderboard and management review.

| Feature ID | Feature | Class | User | Problem | Tests |
|---|---|---|---|---|---|
| F-01 | Landing page with role-based sign-in | R1 | All | One entry point; each role sees its seat | e2e: sign-in |
| F-02 | Main dashboard (company KPIs, activity, wins, announcements, agenda) | R1 | All | Shared view of performance | api: main dashboard visible to all |
| F-03 | Personal dashboard (KPIs, goals, tasks, agenda, points, achievements) | R1 | All | Each member’s own report | api: member dashboard scoping |
| F-04 | Team control (per-member numbers, workload, status, drill-down) | R1 | Team lead, Manager, Admin | Management review and control | api: team overview; e2e: drill-down |
| F-05 | Leads with ownership history, statuses, reasons | R1 | All | Lead capture & qualification | api: lead workflow |
| F-06 | Explainable property matching | R1 | All | Match requirement to authorized inventory | unit BR-050..053; api matches |
| F-07 | Pipeline (kanban, state machine, won/lost rules) | R1 | All | Track pursuits to outcome | unit BR-010..016; api |
| F-08 | Listings with authority & availability confidence | R1 | All | Avoid sharing stale/unverified units | api: external authority not changed |
| F-09 | Tasks: assign → submit → approve / request changes | R1 | All | Work assigned and reported to management | unit BR-020..025; api; e2e |
| F-10 | Calendar (week/month), invites, RSVP, conflicts, outcomes | R1 | All | Meeting tracking and time management | api: calendar; e2e |
| F-11 | Time insights (hours by type, double bookings, no-shows) | R1 | Team lead, Manager, Admin | Time-management decisions | api: scoping |
| F-12 | Team chat: company, team, DM, @mentions, real-time | R1 | All | Team communication | api: chat + SSE; e2e |
| F-13 | Leaderboard, points ledger, achievements, monthly goals | R1 | All | Motivation and fair recognition | api: ranking, cap, idempotency |
| F-14 | Notifications (in-app, deduplicated, live) | R1 | All | Nobody misses assignments/reviews | api: dedupe keys |
| F-15 | People & teams admin, permission matrix, audit log | R1 | Admin, Manager | Control & accountability | api: admin |
| F-16 | Reservations with DB-enforced single hold, 48h expiry, renew once, confirm with reference (E2) | **R1** | Agent, Manager | Developer sales need safe holds | AC-RES-01..03 in `tests/saas.test.js` |
| F-16b | Projects deciding availability authority; listings inherit it | **R1** | Manager | Availability depends on the project (Q-04) | saas.test › projects |
| F-23 | Self-signup, trial, plans, seat/listing limits, read-only, export | **R1** | Brokerage owner | Sell to other brokerages (Q-01) | saas.test › signup, workspace |
| F-24 | Platform console (Dara staff) | **R1** | Dara | Manage subscriptions across brokerages | saas.test › platform |
| F-25 | Dubai compliance fields and expiry reminders (BRN, ORN, trade licence, permits) | **R1** | Admin, Manager | Stay on top of renewals | saas.test › compliance |
| F-26 | Offers/counter-offers with negotiation history and discount approval | R2 | Agent, Manager | Negotiation audit | — |
| F-17 | WhatsApp / email / SMS channels | R2 | Agent | Outbound comms | — (needs provider accounts) |
| F-18 | Portal lead ingestion (Property Finder, Bayut, Dubizzle) | R2 | Ops | Automated capture | — (needs partner access) |
| F-19 | Commission splits, rule versions, payables | Excluded (Q-05: show gross total only) | — | — | — |
| F-20 | AI assistance (summaries, follow-up drafts) | Later | Agent | Productivity | — (needs evaluation set) |
| F-21 | Leasing (Ejari), KYC/AML fields, documents | Later | Ops | Compliance tracking | — |
| F-22 | Payment-provider billing, dunning, invoices | R2 (needs provider choice, A5) | Dara | Collect subscription revenue | — |

## Explicit exclusions
Payments (the platform never holds funds) · Real outbound customer messaging · Government system integrations · Legal or regulatory certification claims · Real customer data.

## Active modules: Part F [yes — no payment provider], Part G [yes — tracking/reminders only, all rules `[Verify]`]
