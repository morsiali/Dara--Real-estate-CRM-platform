-- PostgreSQL variant of the SQLite migration (BIGINT for integers; same names and constraints).
-- 002: multi-tenant SaaS (Part F), projects with availability authority, reservations (E2), Dubai fields (Part G, all [Verify]).

-- Tenancy & subscription state (billing provider = source of truth for payment only; not integrated).
ALTER TABLE tenants ADD COLUMN slug TEXT;
ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE tenants ADD COLUMN trial_ends_at TEXT;
ALTER TABLE tenants ADD COLUMN is_platform BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN trade_licence_no TEXT;
ALTER TABLE tenants ADD COLUMN trade_licence_expiry TEXT;
ALTER TABLE tenants ADD COLUMN orn TEXT;
CREATE UNIQUE INDEX ux_tenants_slug ON tenants(slug) WHERE slug IS NOT NULL;

-- One account per email across the whole platform, so sign-in needs no workspace picker (ADR-009).
DROP INDEX ux_users_email;
CREATE UNIQUE INDEX ux_users_email_global ON users(lower(email));
ALTER TABLE users ADD COLUMN platform_admin BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN brn TEXT;
ALTER TABLE users ADD COLUMN brn_expiry TEXT;

-- Projects carry the availability authority; their listings inherit it.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  developer TEXT,
  community TEXT,
  city TEXT NOT NULL DEFAULT 'Dubai',
  completion TEXT NOT NULL DEFAULT 'ready' CHECK (completion IN ('ready','off_plan')),
  handover TEXT,
  authority TEXT NOT NULL DEFAULT 'platform' CHECK (authority IN ('platform','external')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_projects_name ON projects(tenant_id, lower(name));

-- No REFERENCES on project_id so the down migration can drop the column; integrity is enforced in the service.
ALTER TABLE properties ADD COLUMN project_id TEXT;
ALTER TABLE properties ADD COLUMN permit_expiry TEXT;
CREATE INDEX ix_properties_project ON properties(project_id);

-- Reservations (E2).
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  deal_id TEXT REFERENCES deals(id),
  contact_id TEXT REFERENCES contacts(id),
  agent_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('held','pending_confirmation','confirmed','expired','cancelled','converted')),
  authority TEXT NOT NULL CHECK (authority IN ('platform','external')),
  expires_at TEXT,
  renewals BIGINT NOT NULL DEFAULT 0,
  deposit_note TEXT,
  external_ref TEXT,
  oqood_ref TEXT,
  cancel_reason TEXT,
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- BR-021 / AC-RES-01: at most one active reservation per unit, enforced by the database.
CREATE UNIQUE INDEX ux_reservation_active ON reservations(tenant_id, property_id) WHERE status IN ('held','pending_confirmation','confirmed');
CREATE INDEX ix_reservations_expiry ON reservations(status, expires_at);
