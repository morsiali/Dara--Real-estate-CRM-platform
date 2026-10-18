# Changelog

## 2026-10-19 — Increment 03: PostgreSQL + RLS, sign-in security, compliance switches, Docker
- **Changed:** Async data layer over SQLite and PostgreSQL. Migrations `003`/`004` (Postgres RLS on every table; auth tables). Two-step sign-in with recovery codes, email verification, forgot/reset password, admin reset, two compliance switches (off by default), Docker + compose. New UI: sign-in second step, forgot/reset forms, signup confirmation, forced setup screen for admins, Two-step sign-in dialog, verification banner, policy switches, People two-step column. Report: `docs/increments/03-postgres-rls-auth.md`.
- **Evidence:** `npm test` → 110/110 (SQLite). `npm run test:pg` → 117/117 (PGlite, RLS enforced). `node scripts/e2e.mjs` → 16/16 on SQLite and 16/16 on a real PostgreSQL 16 server, no browser errors.
- **Status changes:** ADR-012 superseded by ADR-013. CAP-036…040 → Verified locally. CAP-041 (Docker) → Implemented — unverified.
- **Open blocking questions:** Q-13 hosting region / data-protection regime · Q-14 pricing and payment provider · Q-09 SSO provider (optional) · mail provider for real email delivery.

## 2026-10-19 — Increment 02: SaaS, projects, reservations, Dubai compliance
- **Changed:** Operator answered Q-01…Q-05. Added migration `002`. Added self-signup and trial, entitlements, read-only mode, export, platform console, projects with availability authority, reservations (E2), Dubai compliance reminders, and a second synthetic tenant plus a platform tenant. Added new screens (Projects, Reservations, Workspace & compliance, Platform console) and landing sections (Plans, Start a trial). Report: `docs/increments/02-saas-reservations.md`.
- **Evidence:** `npm test` → 95 tests, 95 passed, 0 failed. `node scripts/e2e.mjs` → 13/13 PASS, no browser errors.
- **Status changes:** CAP-025 → Verified locally. CAP-028…034 → Verified locally. CAP-035 → Specified.
- **Open blocking questions:** Q-09 MFA/identity provider · Q-13 hosting region and data-protection regime · Q-14 pricing and payment provider · ADR-012 Postgres + RLS before production.
- **Next:** Migrate to Postgres with RLS. Add email verification on signup and an identity provider with MFA. Then offers and negotiation (F-26) and comms adapters (F-17).

## 2026-10-19 — Fast path (A8) → Release 1 prototype (Increment 01)
- **Changed:** Created the state files. Built the server (auth, RBAC, CRM, work management, chat, insights, admin), synthetic seed, landing page and workspace SPA. Report: `docs/increments/01-release1-prototype.md`.
- **Evidence:** `npm test` → 66 tests, 66 passed, 0 failed (unit, API, migration). `node scripts/e2e.mjs` → 10/10 browser flows passed with no browser errors. All workspace pages and the landing page were screenshotted at desktop, mobile (390 px) and Arabic RTL, and reviewed.
- **Status changes (CAPABILITIES):** CAP-001…020 → Verified locally. CAP-021, CAP-022 → Implemented — unverified. CAP-023…027 → Specified.
- **Open blocking questions:** Q-01 deployment/tenant model · Q-02 operating model · Q-03 jurisdictions and residency · Q-04 inventory authority · Q-05 money role · Q-09 MFA/identity provider (before production).
- **Next:** Operator reviews the prototype and answers Q-01…Q-05. Then formally approve SCOPE and plan R2 slices (reservations E2, comms adapters, portal ingestion, commission rules).
