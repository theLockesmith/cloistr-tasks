-- 020_ical_token.sql
-- Add an iCal feed token to user_settings so calendar apps can subscribe
-- to a user's tasks without interactive Nostr authentication.
--
-- The token is stored in plaintext: it grants read-only access to task
-- titles and due dates, and an attacker with DB access already has that
-- data. Hashing would prevent lookup-by-token in the feed endpoint.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS ical_token VARCHAR(64) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_user_settings_ical_token
ON user_settings (ical_token)
WHERE ical_token IS NOT NULL;
