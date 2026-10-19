# Capability register

Status vocabulary (D6): `Specified` · `Implemented — unverified` · `Verified locally` · `Verified with sandbox` · `Verified in target environment` · `Blocked` · `Unavailable`.
"Verified locally" means the automated tests and the browser end-to-end run passed on synthetic data in a local environment, with the evidence noted. Nothing has been verified in a target or production environment.

| ID | Capability | Scope | Status | Evidence | Dependencies | Known limitations | Owner |
|---|---|---|---|---|---|---|---|
| CAP-001 | Sign-in, sessions, sign-out, password change, login throttle | R1 | Verified locally | `tests/api.test.js` › authentication; e2e sign-in/sign-out | — | Two-step sign-in and email reset added (CAP-037, CAP-039) | Eng |
| CAP-002 | CSRF guard + security headers (CSP, nosniff, frame deny) | R1 | Verified locally | api › CSRF, security headers | — | HTTPS/Secure cookie only when `NODE_ENV=production` behind TLS | Eng |
| CAP-003 | Role scoping Own/Team/Tenant on every endpoint | R1 | Verified locally | api › record scoping, admin, tasks, chat | rbac.js | — | Eng |
| CAP-004 | Tenant isolation (data layer) | R1 | Verified locally | api › tenant isolation; saas.test › cross-tenant reservations, export scoping | — | SQLite mode: app-level only. Postgres mode: forced RLS (CAP-036) | Eng |
| CAP-005 | Landing page with role seats, calculator, sign-in | R1 | Verified locally | e2e; screenshots | — | Calculator is illustrative, user-supplied assumptions | Product |
| CAP-006 | Main dashboard for all roles | R1 | Verified locally | api › main dashboard; analytics consistency | analytics.js | Single currency (AED) totals | Product |
| CAP-007 | Personal dashboards, goals, achievements | R1 | Verified locally | api › member dashboard; goals | — | — | Product |
| CAP-008 | Team control (management review & drill-down) | R1 | Verified locally | api › team overview; e2e drill-down | — | — | Product |
| CAP-009 | Leads: capture, assignment (self/manual/round-robin), statuses, history | R1 | Verified locally | unit BR-001/002/030; api › lead workflow; e2e add lead | — | No duplicate-detection/merge yet | Eng |
| CAP-010 | Explainable matching | R1 | Verified locally | unit BR-050..053; api matches; e2e | properties | Rule-based, not AI | Eng |
| CAP-011 | Pipeline kanban + deal state machine + won side-effects | R1 | Verified locally | unit BR-010..016; api › won/reopen/lost/external | — | Drag-and-drop needs a pointer; keyboard path via deal dialog | Eng |
| CAP-012 | Listings with authority, confidence, verify | R1 | Verified locally | api › external authority unchanged | — | No media upload; no portal sync | Eng |
| CAP-013 | Task assignment → submit → review | R1 | Verified locally | unit BR-020..025; api › tasks; e2e assign/submit/approve | — | — | Eng |
| CAP-014 | Calendar week/month, invites, RSVP, conflicts, outcomes | R1 | Verified locally | api › calendar; e2e conflict | — | No external calendar sync (Google/Outlook) | Eng |
| CAP-015 | Time insights | R1 | Verified locally | api › scoping; screenshots | — | Fixed UTC+4 offset (A-03) | Product |
| CAP-016 | Real-time chat (channels, team, DM, mentions) | R1 | Verified locally | api › chat incl. SSE delivery; e2e live message | SSE | Single process; no attachments, edits or deletes | Eng |
| CAP-017 | Leaderboard, points ledger (idempotent, capped) | R1 | Verified locally | api › leaderboard, cap; points-once assertions | — | Values need sales-director sign-off (Q-08) | Product |
| CAP-018 | In-app notifications, deduplicated, live | R1 | Verified locally | api dedupe-key assertions; e2e badge | — | No email/push delivery | Eng |
| CAP-019 | People & teams admin, permission matrix view, audit log | R1 | Verified locally | api › administration | — | Audit log has no export yet | Eng |
| CAP-020 | Migrations up/down on populated DB | R1 | Verified locally | `tests/migrations.test.js` | — | Down migration is destructive (A5) | Eng |
| CAP-021 | Arabic RTL layout | R1 | Implemented — unverified | e2e toggles `dir=rtl`; screenshot | i18n.js | Partial translation (nav, headings, KPI labels); needs native review | Product |
| CAP-022 | Accessibility (WCAG 2.2 AA target) | R1 | Implemented — unverified | Keyboard focus, labels, focus trap, reduced motion built in | — | No axe scan or manual audit run yet | Eng |
| CAP-023 | WhatsApp / email / SMS channels | R2 | Specified | — | Provider accounts | Not built | — |
| CAP-024 | Portal lead ingestion | R2 | Specified | — | Partner access | Not built | — |
| CAP-025 | Reservations with DB-enforced single hold, expiry, renewal, confirmation (E2) | R1 | Verified locally | saas.test › AC-RES-01 (30 concurrent → 1 success, 29 × 409), AC-RES-02, AC-RES-03, renewal, conversion; e2e hold | — | Expiry sweep runs in-process every 30s (single instance) | Eng |
| CAP-026 | AI summaries / drafts | Later | Specified | — | Evaluation set | Not built | — |
| CAP-027 | Backup & restore | R1-ops | Specified | — | — | No drill run (RISK-07) | Operator |
| CAP-028 | Brokerage self-signup with 14-day trial | R1 | Verified locally | saas.test › signup; e2e signup | — | Verification email goes to a local outbox (no mail provider) | Eng |
| CAP-029 | Entitlements: seat and listing limits, 80% warning | R1 | Verified locally | saas.test › seat limit incl. reactivation; unit F4 | billing.js | Limits are proposed | Eng |
| CAP-030 | Read-only mode for suspended / cancelled / expired-trial workspaces | R1 | Verified locally | saas.test › expired trial, platform suspension | — | — | Eng |
| CAP-031 | Full JSON data export (admin, never plan-gated) | R1 | Verified locally | saas.test › export content and scoping | — | JSON only (CSV later) | Eng |
| CAP-032 | Platform console: workspaces, plan and status changes, notified and audited | R1 | Verified locally | saas.test › platform; e2e | — | Manual; no billing provider | Eng |
| CAP-033 | Projects with availability authority and cascade | R1 | Verified locally | saas.test › projects | — | A unit can't be unlinked from a project in the UI | Eng |
| CAP-034 | Dubai compliance fields and expiry reminders | R1 | Verified locally | saas.test › compliance | — | Tracking only; every rule `[Verify]` | Eng |
| CAP-035 | Payment-provider billing / dunning | R2 | Specified | — | Q-14, A5 | Not built | — |
| CAP-036 | PostgreSQL backend with forced row-level security per tenant | R1 | Verified locally | `npm run test:pg` → 117/117 on PGlite incl. `tests/rls.test.js` (no-WHERE reads, cross-tenant insert/update/delete refused, context does not leak, every table forced); e2e 16/16 against **PostgreSQL 16** via `pg` as a non-superuser owner | `pg` driver, Postgres 16 | Protects against app bugs, not arbitrary SQL as the app role (ADR-013) | Eng |
| CAP-037 | Two-step sign-in (TOTP + recovery codes), encrypted secret, admin requirement, admin reset | R1 | Verified locally | `tests/security.test.js` (RFC 6238 vectors, drift window, replay, single-use challenge, recovery codes, reset); e2e setup + code sign-in + recovery code | `DARA_SECRET_KEY` | No SSO / identity provider yet (Q-09) | Eng |
| CAP-038 | Email verification at signup; unverified owners can't invite | R1 | Verified locally | security.test › verification; e2e signup | Mail provider | Emails go to the outbox only (A5) | Eng |
| CAP-039 | Forgot / reset password by email link | R1 | Verified locally | security.test › forgot/reset (no account enumeration, single use, signs out everywhere); e2e | Mail provider | Outbox only | Eng |
| CAP-040 | Compliance switches: expired BRN / expired permit blocks (off by default) | R1 | Verified locally | security.test › compliance policies; e2e toggles | — | Rules `[Verify]` with counsel | Eng |
| CAP-041 | Docker image + compose stack (app + PostgreSQL 16, non-superuser role model) | R1-ops | Implemented — unverified | Role script and migrations verified on a real PostgreSQL 16 server; app verified against it. The Docker image itself was **not built** here (no Docker in this environment) | Docker | Run `docker compose up --build` once to verify | Eng |
| CAP-042 | Render Blueprint (`render.yaml`): web service + PostgreSQL 16, Frankfurt, generated secret | R1-ops | Implemented — unverified | Same startup verified against a Render-like database (non-superuser owner without CREATEROLE): RLS forced on owner, e2e 16/16. Not yet deployed on Render | Render account | Free plans sleep/expire; no UAE region (Q-13) | Operator |
