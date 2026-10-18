-- 004 (PostgreSQL): sign-in security and compliance enforcement switches. Mirrors SQLite 003.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_secret_enc TEXT;
ALTER TABLE users ADD COLUMN mfa_last_counter BIGINT NOT NULL DEFAULT -1;
ALTER TABLE users ADD COLUMN mfa_recovery TEXT;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

ALTER TABLE tenants ADD COLUMN mfa_required_admins BIGINT NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN policy_block_expired_brn BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN policy_block_expired_permit BIGINT NOT NULL DEFAULT 0;

CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password','mfa_challenge')),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_auth_tokens_hash ON auth_tokens(token_hash);
CREATE INDEX ix_auth_tokens_user ON auth_tokens(user_id, purpose);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_tokens TO :app_role;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_tokens
  USING (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM users x WHERE x.id = auth_tokens.user_id))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR EXISTS (SELECT 1 FROM users x WHERE x.id = auth_tokens.user_id));
