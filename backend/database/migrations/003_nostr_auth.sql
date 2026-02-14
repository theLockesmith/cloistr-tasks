-- 003_nostr_auth.sql
-- Migration from Keycloak to Nostr authentication

-- Add pubkey column to users table (64-char hex string)
ALTER TABLE users ADD COLUMN IF NOT EXISTS pubkey VARCHAR(64) UNIQUE;

-- Make email and username nullable (Nostr users might not have these)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;

-- Drop unique constraints on email/username (will be nullable)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;

-- Add partial unique constraints (only enforce uniqueness when not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username) WHERE username IS NOT NULL;

-- Create index for pubkey lookups
CREATE INDEX IF NOT EXISTS idx_users_pubkey ON users(pubkey);

-- Auth challenges table for challenge-response authentication
CREATE TABLE IF NOT EXISTS auth_challenges (
    id SERIAL PRIMARY KEY,
    challenge VARCHAR(64) NOT NULL UNIQUE,
    nonce VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false,
    used_by VARCHAR(64), -- pubkey of user who used the challenge
    used_at TIMESTAMP
);

-- Index for cleanup of expired challenges
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON auth_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_challenges_used ON auth_challenges(used);

-- Function to clean up expired challenges (call periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM auth_challenges
    WHERE expires_at < NOW() OR (used = true AND used_at < NOW() - INTERVAL '1 hour');
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Update comments
COMMENT ON TABLE users IS 'User accounts authenticated via Nostr (pubkey)';
COMMENT ON COLUMN users.pubkey IS 'Nostr public key (64-char hex string)';
COMMENT ON TABLE auth_challenges IS 'Challenge-response tokens for Nostr authentication';
COMMENT ON FUNCTION cleanup_expired_challenges IS 'Remove expired and used authentication challenges';
