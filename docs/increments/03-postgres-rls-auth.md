# Increment 03 — PostgreSQL with row-level security, sign-in security, compliance switches, Docker
Trigger: operator instruction "Do the best and go ahead" (2026-10-19).
Implements: ADR-013 (async data layer + Postgres RLS), ADR-014 (two-step sign-in, email verification, password reset), ADR-015 (compliance switches), C13 database-level isolation.

## Changes
- **Data layer:** `server/db.js` exposes one async API over SQLite (`node:sqlite`), PostgreSQL (`pg`) and PGlite (tests). Each request runs in one transaction with `app.tenant_id` / `app.bypass_rls` set locally and `SET LOCAL ROLE dara_app`. Every route, service and the seed were converted to `await`.
- **Migrations:**
  - SQLite `003_auth_security`
  - Postgres `003_row_level_security` (role, grants, forced RLS policies on every table)
  - Postgres `004_auth_security`
  - All have down scripts. Existing users are marked verified on upgrade, so nobody is locked out.
- **Auth API:**
  - `/api/auth/mfa/{setup,enable,disable,recovery-codes,verify}`
  - `/api/auth/verify-email`, `/api/auth/resend-verification`, `/api/auth/forgot`, `/api/auth/reset`
  - A guard returns `MFA_SETUP_REQUIRED` for admins who must set up two-step sign-in.
- **Policies:**
  - `PATCH /api/workspace` accepts `mfa_required_admins`, `policy_block_expired_brn`, `policy_block_expired_permit` (admins only).
  - When on, these are enforced in reservations (`BRN_EXPIRED`, `PERMIT_EXPIRED`) and lead assignment (manual and round-robin).
- **Admin:**
  - `PATCH /api/users/:id { reset_mfa }` (admin only, audited, signs the person out).
  - `POST /api/users` requires a verified email.
- **UI:**
  - Landing: two-step code card, forgot and reset cards (the token is removed from the address bar), signup confirmation with a dev-mode link.
  - App: forced setup screen with QR code (vendored MIT `qrcode-generator`, drawn as DOM SVG under the strict CSP) and recovery codes (copy/download). Also a "Two-step sign-in" account dialog, verification banner, policy switches and a People two-step column with reset.
- **Ops:**
  - `Dockerfile` (non-root, healthcheck), `docker-compose.yml` (app + Postgres 16, DB not published), `docker/initdb.sh` (non-superuser owner + app role).
  - `.env.example`; `COOKIE_SECURE` / `DEV_LINKS` overrides; production refuses to start without `DARA_SECRET_KEY`; graceful SIGTERM.

## Verification (actual output)
- `npm test` (SQLite) → `tests 110 · pass 110 · fail 0`.
- `npm run test:pg` (PGlite, RLS enforced as `dara_app`) → `tests 117 · pass 117 · fail 0`. This includes `tests/rls.test.js`:
  - the app role is neither superuser nor BYPASSRLS
  - reads with no WHERE clause see only the tenant's own rows
  - child tables are scoped through their parent
  - no context sees nothing
  - cross-tenant insert, update, delete and re-parenting are refused
  - the context does not leak between transactions
  - every table has forced RLS
- `tests/security.test.js` (both backends) covers:
  - RFC 6238 vectors, drift window and replay
  - encryption tamper detection
  - a single-use challenge, with no cookie before step 2
  - recovery codes
  - admin reset and its permissions
  - signup verification and the admin setup guard
  - forgot/reset (no account enumeration; signs out everywhere)
  - both compliance switches, off by default
- `node scripts/e2e.mjs` → 16 PASS, "No browser errors." on SQLite, **and 16 PASS against a real PostgreSQL 16 server**:
  - The app ran with `NODE_ENV=production`, connected through `pg` as the non-superuser `dara_owner` created by `docker/initdb.sh`.
  - `psql` as that owner with no context: `leads` count 0.
- Role model check on PG semantics:
  - the owner without context sees 0 tenants
  - `SET ROLE postgres` is refused
  - all down migrations run cleanly
- Visual check: forced setup (desktop and 390 px), setup dialog, sign-in second step and policy switches were screenshotted and reviewed. Fixed: grid placement, key wrapping, mobile overflow.

## Definition of Done
- [x] Tenant isolation enforced in the database (Postgres) with automated proof
- [x] Permission allow/deny tests for every new endpoint
- [x] Reversible migrations on both backends
- [x] Loading, error and success states on new screens; keyboard and labels; reduced motion respected
- [x] Audit events: MFA on/off, recovery codes regenerated or used, email verified, reset requested or done, MFA reset by admin, policy changes
- [x] CAPABILITIES, DECISIONS, RISKS, QUESTIONS updated
- [ ] Docker image built and run — **not done here** (no Docker in this environment); everything it runs was verified separately
- [ ] Lint/typecheck — not run (zero-dependency build)

## Limitations
- No mail provider: emails go to `OUTBOX_DIR`.
- No SSO.
- RLS defends against application bugs, not arbitrary SQL run as the app role (ADR-013).
- Real-time chat and sweeps remain single-process.
- Pricing and payments are still open (Q-14), and so is the hosting region (Q-13).

## Next slice proposed
1. Connect a transactional mail provider (needs your account) and, optionally, Microsoft/Google SSO.
2. Hosting in a UAE region once Q-13 is decided; backup/restore drill (CAP-027).
3. Offers and negotiation (F-26), then WhatsApp/email adapters (F-17).
