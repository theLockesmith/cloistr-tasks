-- 024_nip98_replay.sql
--
-- NIP-98 request signatures are accepted on GET /api/cards (for other
-- Cloistr apps calling with the user's signer). A signed event is valid for
-- 60 seconds; this table records event ids already used so the same event
-- cannot be replayed inside that window. It lives in Postgres rather than in
-- memory so the guard holds across backend replicas.
--
-- Down: database/migrations/down/024_nip98_replay.sql

CREATE TABLE IF NOT EXISTS nip98_seen_events (
    event_id    CHAR(64) PRIMARY KEY,
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nip98_seen_events_expires
    ON nip98_seen_events (expires_at);
