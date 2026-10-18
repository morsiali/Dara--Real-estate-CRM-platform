-- 001_init: core schema for Dara Release 1.
-- Conventions: UUIDv7 text ids, UTC ISO-8601 timestamps, money as integer minor units + ISO 4217 currency,
-- rates as integer basis points. Every business table carries tenant_id (single tenant today, see ADR-001).

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  tz_offset_min INTEGER NOT NULL DEFAULT 240,
  locale TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  lead_id TEXT,
  rr_last_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  team_id TEXT REFERENCES teams(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','team_lead','agent')),
  title TEXT,
  phone TEXT,
  color TEXT NOT NULL DEFAULT '#2a78d6',
  locale TEXT NOT NULL DEFAULT 'en',
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_users_email ON users(tenant_id, lower(email));
CREATE INDEX ix_users_team ON users(team_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner_id TEXT REFERENCES users(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  roles TEXT NOT NULL DEFAULT '["buyer"]',
  preferred_language TEXT DEFAULT 'en',
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- Phone and email are intentionally NOT unique (families, offices share them).
CREATE INDEX ix_contacts_owner ON contacts(owner_id);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  owner_id TEXT REFERENCES users(id),
  team_id TEXT REFERENCES teams(id),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','nurturing','disqualified','converted')),
  source TEXT NOT NULL DEFAULT 'manual',
  campaign TEXT,
  transaction_type TEXT NOT NULL DEFAULT 'buy' CHECK (transaction_type IN ('buy','rent')),
  budget_max INTEGER,
  currency TEXT NOT NULL DEFAULT 'AED',
  property_types TEXT NOT NULL DEFAULT '[]',
  locations TEXT NOT NULL DEFAULT '[]',
  bedrooms_min INTEGER,
  notes TEXT,
  disqualify_reason TEXT,
  first_contact_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_leads_owner ON leads(owner_id, status);
CREATE INDEX ix_leads_created ON leads(tenant_id, created_at);

CREATE TABLE lead_status_history (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id TEXT,
  owner_id TEXT,
  reason TEXT,
  at TEXT NOT NULL
);
CREATE INDEX ix_lsh_at ON lead_status_history(to_status, at);

CREATE TABLE lead_assignments (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  from_user_id TEXT,
  to_user_id TEXT NOT NULL,
  actor_id TEXT,
  method TEXT NOT NULL CHECK (method IN ('round_robin','manual','self')),
  at TEXT NOT NULL
);

CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('apartment','villa','townhouse','penthouse','office','retail','land')),
  listing_type TEXT NOT NULL DEFAULT 'sale' CHECK (listing_type IN ('sale','rent')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_hold','reserved','sold','rented','off_market')),
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AED',
  bedrooms INTEGER,
  bathrooms INTEGER,
  area_sqft INTEGER,
  community TEXT,
  project TEXT,
  developer TEXT,
  city TEXT NOT NULL DEFAULT 'Dubai',
  completion TEXT NOT NULL DEFAULT 'ready' CHECK (completion IN ('ready','off_plan')),
  authority TEXT NOT NULL DEFAULT 'platform' CHECK (authority IN ('platform','external','unverified')),
  availability_confidence TEXT NOT NULL DEFAULT 'confirmed' CHECK (availability_confidence IN ('confirmed','stale','unverified')),
  last_verified_at TEXT,
  permit_no TEXT,
  agent_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_properties_ref ON properties(tenant_id, ref);
CREATE INDEX ix_properties_status ON properties(tenant_id, status);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  lead_id TEXT REFERENCES leads(id),
  property_id TEXT REFERENCES properties(id),
  owner_id TEXT REFERENCES users(id),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','viewing','offer','negotiation','reservation','won','lost')),
  value INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AED',
  commission_bp INTEGER NOT NULL DEFAULT 200,
  expected_close TEXT,
  closed_at TEXT,
  lost_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_deals_owner ON deals(owner_id, stage);
CREATE INDEX ix_deals_closed ON deals(tenant_id, stage, closed_at);

CREATE TABLE deal_stage_history (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deals(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  actor_id TEXT,
  reason TEXT,
  at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','submitted','changes_requested','approved','cancelled')),
  assignee_id TEXT NOT NULL REFERENCES users(id),
  creator_id TEXT NOT NULL REFERENCES users(id),
  due_at TEXT,
  related_type TEXT,
  related_id TEXT,
  submission_note TEXT,
  review_note TEXT,
  reviewer_id TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_tasks_assignee ON tasks(assignee_id, status);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('meeting','viewing','call','internal','focus')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  location TEXT,
  organizer_id TEXT NOT NULL REFERENCES users(id),
  contact_id TEXT REFERENCES contacts(id),
  deal_id TEXT REFERENCES deals(id),
  property_id TEXT REFERENCES properties(id),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  outcome TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX ix_events_time ON events(tenant_id, start_at);

CREATE TABLE event_attendees (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined')),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX ix_attendees_user ON event_attendees(user_id);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('call','email','whatsapp','note')),
  contact_id TEXT REFERENCES contacts(id),
  lead_id TEXT REFERENCES leads(id),
  deal_id TEXT REFERENCES deals(id),
  summary TEXT NOT NULL,
  duration_min INTEGER,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_activities_user ON activities(user_id, occurred_at);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('public','team','dm')),
  team_id TEXT REFERENCES teams(id),
  dm_key TEXT,
  topic TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_channels_dm ON channels(tenant_id, dm_key) WHERE dm_key IS NOT NULL;

CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  last_read_at TEXT,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user','system')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_messages_channel ON messages(channel_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_notifications_dedupe ON notifications(user_id, dedupe_key);

CREATE TABLE points_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
-- Idempotency: one award per (source, user). Re-processing an event never double-counts.
CREATE UNIQUE INDEX ux_points_source ON points_ledger(user_id, source_type, source_id);
CREATE INDEX ix_points_at ON points_ledger(tenant_id, at);

CREATE TABLE user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('won_volume','deals_won','viewings_done','calls_logged')),
  target INTEGER NOT NULL CHECK (target > 0),
  set_by TEXT,
  UNIQUE (user_id, month, metric)
);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  data TEXT,
  at TEXT NOT NULL
);
CREATE INDEX ix_audit_at ON audit_log(tenant_id, at);
