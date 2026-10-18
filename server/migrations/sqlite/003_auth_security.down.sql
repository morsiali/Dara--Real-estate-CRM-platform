-- Reverses 003. Destructive (drops two-step secrets and tokens): requires explicit operator authorization (A5).
DROP TABLE IF EXISTS auth_tokens;
ALTER TABLE tenants DROP COLUMN policy_block_expired_permit;
ALTER TABLE tenants DROP COLUMN policy_block_expired_brn;
ALTER TABLE tenants DROP COLUMN mfa_required_admins;
ALTER TABLE users DROP COLUMN mfa_recovery;
ALTER TABLE users DROP COLUMN mfa_last_counter;
ALTER TABLE users DROP COLUMN mfa_secret_enc;
ALTER TABLE users DROP COLUMN mfa_enabled;
ALTER TABLE users DROP COLUMN email_verified_at;
