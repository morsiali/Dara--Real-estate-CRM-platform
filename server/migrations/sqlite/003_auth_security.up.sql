-- 003: sign-in security (two-step sign-in, email verification, password reset) and compliance enforcement switches.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_secret_enc TEXT;
ALTER TABLE users ADD COLUMN mfa_last_counter INTEGER NOT NULL DEFAULT -1;
ALTER TABLE users ADD COLUMN mfa_recovery TEXT;
-- Existing accounts predate verification: treat them as verified so nobody is locked out by the upgrade.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- Workspace policies. MFA for administrators defaults ON for new workspaces (C13); compliance blocks default OFF (Q-15).
ALTER TABLE tenants ADD COLUMN mfa_required_admins INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN policy_block_expired_brn INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN policy_block_expired_permit INTEGER NOT NULL DEFAULT 0;

-- One-time tokens for email verification, password reset and the second sign-in step. Stored hashed.
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
