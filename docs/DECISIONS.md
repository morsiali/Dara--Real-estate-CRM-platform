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
- Status: Accepted for prototype / **Blocking for production**
- Context: C13 asks for database-level isolation (RLS) for multi-tenant SaaS. SQLite has no RLS, so isolation is enforced only by the tenant-scoped data layer, which is tested.
- Decision: Keep the zero-dependency build for evaluation. Migrate to Postgres with RLS policies per `tenant_id` before the first paying customer.
- Reversibility: Reversible. Domain logic is framework-free, and the SQL is mostly portable.
