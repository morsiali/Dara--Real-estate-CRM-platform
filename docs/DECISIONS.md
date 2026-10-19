# Decisions (ADR log)

## ADR-000 — Operator requested immediate build (fast path)
- Date / Status: 2026-10-18 / Accepted
- Context: The operator supplied the master prompt and asked for a complete, working platform in the same request.
- Decision: Apply A8 fast path. Use Part H defaults for reversible items. Build Release 1 as a local prototype on synthetic data. Keep the 5 irreversible decisions open as Blocking questions, and design so each can still change.
- Alternatives rejected: Stop at Mode A discovery, which contradicts the explicit instruction to build.
- Consequences / reversibility: Reversible. No production environment, real data, payments or messaging were touched (A5).
- Decided by: Operator (request), lead engineer (method).

## ADR-001 — Single-organization internal tool with a tenant-ready schema
- Status: Superseded by ADR-008 (operator answer to Q-01, 2026-10-19)
- Decision: Run one tenant. Every table has `tenant_id`, every query is tenant-scoped, and cross-tenant tests run in CI.
- Alternatives rejected: (a) Full multi-tenant SaaS now — needs Part F billing and row-level security in Postgres, which is premature. (b) A schema without `tenant_id` — moving to SaaS later would be costly.
- Reversibility: Costly once real data exists.

## ADR-002 — Zero-dependency Node + built-in SQLite instead of Next.js + Postgres (deviates from Part H)
- Status: Accepted for the prototype
- Context: The uploaded app (Next.js + Prisma) needed a hosted Postgres and AWS S3 with credentials embedded in `.env`. It could not run on the operator’s machine without those, and it lacked most requested modules.
- Decision: Use a modular monolith on Node ≥ 22.13 with `node:http`, `node:sqlite` and `node:crypto`, and a vanilla ES-module front end. It has no npm dependencies, so `npm start` runs it on Windows/macOS/Linux.
- Alternatives rejected: (a) Extending the Next.js app — external services required and heavy dependency surface. (b) Next.js + SQLite through Prisma — Prisma's SQLite connector lacks scalar lists and enums used by the schema.
- Consequences: Domain logic sits in `server/services` with no framework imports, so it ports directly to Postgres or a framework later. SQLite caps write concurrency; see RISK-03. `node:sqlite` is flagged experimental by Node.
- Reversibility: Reversible. The SQL is standard; migrations are isolated.

## ADR-003 — Server-Sent Events for real-time chat and notifications
- Decision: Use one SSE stream per browser tab. Writes go through REST POST.
- Alternatives rejected: WebSockets, which need a library or custom framing and offer no benefit for one-way pushes.
- Consequences: Single-process only. Horizontal scaling would need a pub/sub fan-out. Reversible.

## ADR-004 — Cookie sessions with CSRF header guard
- Decision: Opaque random tokens, stored as SHA-256 hashes, in an HttpOnly SameSite=Lax cookie. Mutating requests must send `X-Requested-With: dara`. Passwords use scrypt. Login is throttled to 8 failures per 15 minutes per IP and email.
- Alternatives rejected: JWT in localStorage, which is exposed to XSS and cannot be revoked server-side.
- Gap: MFA for administrators is not built (Part C13 default). Tracked in Q-09.

## ADR-005 — Gamification points are an engagement score, never compensation
- Decision: An append-only points ledger, unique per (user, source), with a daily cap of 30 activity points. Points never feed commission.
- Alternatives rejected: Points on every logged action without a cap, which is easy to game.

## ADR-006 — Money as integer minor units; commission in basis points
- Decision: AED fils as integers. Commission = value × bp / 10000 using BigInt, rounded half away from zero (BR-040).

## ADR-007 — Out-of-scope records return 404, not 403
- Decision: Reading another user's or tenant's record returns 404, so the record's existence is not revealed. Role-level denials (e.g., an agent opening team control) return 403.

## ADR-008 — Multi-tenant SaaS with a platform tenant (Part F active)
- Date / Status: 2026-10-19 / Accepted (operator: "software I'll sell to other brokerages")
- Decision: Each brokerage is a tenant. Every row and query is tenant-scoped, and cross-tenant tests cover each resource type. A separate platform tenant holds Dara staff (`platform_admin`), who manage subscriptions but are blocked from all brokerage data endpoints. The server-side entitlement service (`services/billing.js`) is the source of truth for limits. Limits are hard; warnings show at 80%. Suspended, cancelled or expired-trial workspaces become read-only, but stay viewable and exportable. Export is never plan-gated.
- Alternatives rejected: (a) One deployment per brokerage — costly to operate and contradicts self-signup. (b) Showing prices now — no evidence on willingness to pay or cost to serve (F2).
- Reversibility: Costly once paying customers exist.

## ADR-009 — Email is globally unique (one account per email)
- Decision: Sign-in uses email only, with no workspace picker. A unique index on `lower(email)` spans all tenants.
- Alternatives rejected: Per-tenant emails plus a workspace slug at sign-in — more friction and more support load.
- Consequence: A person working for two brokerages needs two emails. Revisit if that becomes common.

## ADR-010 — Availability authority is set per project
- Decision: (operator Q-04) `projects.authority` ∈ {platform, external}. Project units inherit it and cannot override it, except to mark an unverified import. Changing a project cascades to its listings. Standalone units carry their own authority.
- Alternatives rejected: Per-listing authority only — error-prone for developer inventory.

## ADR-011 — Reservations per E2, single active hold enforced by the database
- Decision: A partial unique index `ux_reservation_active(tenant_id, property_id) WHERE status IN (held, pending_confirmation, confirmed)` provides the guard. The application check exists only for friendlier errors. Holds last 48h and can be renewed once by management. Confirmation always requires a developer or registration reference (AC-RES-03). On external-authority units, holds are labelled internal until confirmed. A background sweep expires holds every 30s.
- Alternatives rejected: An application-level check alone — races under concurrency (E2 forbids it).

## ADR-012 — SQLite remains for the prototype; Postgres + row-level security before production SaaS
- Status: **Superseded by ADR-013** (2026-10-19)
- Context: C13 asks for database-level isolation (RLS) for multi-tenant SaaS. SQLite has no RLS, so isolation is enforced only by the tenant-scoped data layer, which is tested.
- Decision: Keep the zero-dependency build for evaluation. Migrate to Postgres with RLS policies per `tenant_id` before the first paying customer.
- Reversibility: Reversible. Domain logic is framework-free, and the SQL is mostly portable.

## ADR-013 — One async data layer over SQLite and PostgreSQL; tenant isolation enforced by row-level security on Postgres
- Status: Accepted (2026-10-19)
- Context: ADR-012 blocked production on database-level isolation (C13). The code base used synchronous SQLite calls everywhere.
- Decision:
  - Every database call is now `await`ed through one adapter API (`get/all/run/exec/tx/withContext/asSystem`). SQLite stays as the zero-install local mode; PostgreSQL is used when `DATABASE_URL` is set. Both run the full test suite (`npm test`, `npm run test:pg` on in-process PGlite).
  - Each HTTP request runs in **one transaction** that sets `app.tenant_id` (and `app.bypass_rls` for system work) with `set_config(..., true)` and `SET LOCAL ROLE dara_app`. Settings are transaction-scoped, so pooled connections never leak a tenant.
  - Migration `003_row_level_security` enables and **forces** RLS on every table: tenant tables compare `tenant_id`; child tables without `tenant_id` check their parent with `EXISTS`. A test asserts no table is left without forced RLS.
  - System context (RLS lifted) is used only for: session lookup, sign-in, signup, password reset, email verification, the global email-uniqueness check, background sweeps and the platform console (aggregates only, after the platform-staff check).
  - Production role model: the app connects as a **non-superuser** owner (`dara_owner`) and switches to `dara_app` per transaction. Superusers bypass RLS, so the app must never connect as one. Verified on PostgreSQL 16: with no context the owner sees 0 rows; `SET ROLE postgres` is refused.
- Limitation (stated honestly): RLS here protects against **application bugs** (a missing `WHERE tenant_id`), not against an attacker who can run arbitrary SQL as the app — the context settings are ordinary session settings. All SQL is parameterized; there is no raw SQL input anywhere.
- Managed hosts (Render) may not allow `CREATE ROLE`. In that case the migration skips the app role, and the app runs as the database owner, which is a non-superuser. **FORCE ROW LEVEL SECURITY still applies the policies to it** (verified on PostgreSQL 16: the owner with no context sees 0 rows; the e2e suite passed 16/16 in this mode). At startup the server refuses to run if it would be a superuser or `BYPASSRLS` without an app role, and it logs which mode it is in.
- Alternatives rejected: Postgres schema-per-tenant (migration fan-out, connection overhead); app-level filtering only (C13).
- Reversibility: Reversible. SQLite remains supported for local use.

## ADR-014 — Built-in two-step sign-in (TOTP), email verification and password reset; outbox instead of a mail provider
- Status: Accepted (2026-10-19). Partially answers Q-09.
- Decision:
  - Two-step sign-in uses authenticator-app codes (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step) with replay protection (last used step stored) and 8 single-use recovery codes stored only as SHA-256 hashes. The TOTP secret is encrypted at rest with AES-256-GCM using `DARA_SECRET_KEY` (required in production).
  - Sign-in with two-step on: password → short-lived single-use challenge (5 min) → code → session. No session cookie exists before the second step.
  - Workspace policy `mfa_required_admins` defaults **on** for new workspaces: an administrator without two-step sign-in can reach only account endpoints until set up. The seeded demo workspaces turn it off for convenience (documented in the seed).
  - Admins can reset another person's two-step sign-in (audited; signs them out). Nobody can reset their own this way.
  - Signup sends an email-verification link (48 h, single use). Unverified owners cannot invite people. Password reset links last 1 hour, are single use, sign the person out everywhere, and the request answers identically whether or not the email exists.
  - No mail provider is connected (A5): emails are written as `.eml` files to `OUTBOX_DIR` and logged. With `DEV_LINKS=1` (default in development, off in production) the links are also returned to the UI.
- Alternatives considered: an external identity provider (Microsoft Entra / Google) — still the likely enterprise path (SSO); it slots in front of the same session model. Not chosen now because no provider was named (Q-09) and it needs paid/tenant setup.
- Reversibility: Reversible.

## ADR-015 — Compliance enforcement is opt-in per workspace
- Status: Accepted (2026-10-19). Default for Q-15.
- Decision: Two switches, both **off** by default: block holds and new lead assignments for agents with an expired BRN (round-robin skips them; manual assignment returns `BRN_EXPIRED`); block holds on listings with an expired advertising permit (`PERMIT_EXPIRED`). When off, expiry only sends reminders. Only administrators can change them; changes are audited.
- Why opt-in: the underlying RERA/DLD rules are `[Verify]` with counsel (Part G), and blocking work on unverified rules would be a product claim we can't stand behind.
