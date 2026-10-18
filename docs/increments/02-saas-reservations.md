# Increment 02 — SaaS layer, projects, reservations, Dubai compliance
Trigger: operator answers to Q-01…Q-05 (2026-10-19).
Implements: Part F (F2–F5, without a payment provider), E2 reservation state machine (BR-021, BR-080…086, AC-RES-01…03), ADR-008…012, Part G tracking fields (all `[Verify]`).

## Changes
- **Schema:** migration `002_saas_projects_reservations` (up/down). Adds tenant subscription fields, a global email index, `projects`, `reservations` with partial unique index, BRN/permit fields.
- **Services:** `billing.js` (plans, access mode, limits); reservation rules in `rules.js`; sweeps for expiry and compliance.
- **API:** `/api/signup`, `/api/plans`, `/api/workspace`, `/api/export`, `/api/platform/*`, `/api/projects`, `/api/reservations`, `/api/compliance`. A read-only guard and a platform-account guard sit in the request pipeline.
- **UI:** landing Plans + Start-a-trial; Projects, Reservations, Workspace & compliance, Platform console; Hold unit from listings and deals; trial/read-only banner; BRN fields.

## Verification (actual output)
- `npm test` → `tests 95 · pass 95 · fail 0` (unit 15, API incl. 29 new SaaS/reservation tests, migrations 3).
- `node scripts/e2e.mjs` → 13 PASS, "No browser errors." (new: signup, hold unit, platform console).
- Migration: 002 down → 001 down → up both, and 002 applied on top of a populated 001 database. Passed.

## Definition of Done
- [x] Acceptance criteria AC-RES-01…03 automated and passing
- [x] Permission allow/deny for every new endpoint and role
- [x] Cross-tenant tests for projects, reservations and export
- [x] Reversible migration
- [x] Loading, empty, error and success states on new screens
- [ ] Strings externalized — partial (nav labels only), as in increment 01
- [x] Audit events (tenant, subscription, project, reservation transitions, export)
- [ ] Lint/typecheck — not run (zero-dependency build)
- [x] CAPABILITIES updated

## Limitations
No payment provider, no email verification, no MFA. SQLite has no RLS (ADR-012). The expiry sweep is in-process. Dubai rules are tracking only.

## Next slice proposed
Postgres + RLS migration (blocking for production), then email verification and an identity provider with MFA.
