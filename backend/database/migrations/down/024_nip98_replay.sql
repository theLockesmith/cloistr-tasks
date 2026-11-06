-- Reverses 024_nip98_replay.sql. Not run automatically; see
-- down/023_column_is_done.sql for how to roll back.
--   DELETE FROM migrations WHERE filename = '024_nip98_replay.sql';

DROP TABLE IF EXISTS nip98_seen_events;
