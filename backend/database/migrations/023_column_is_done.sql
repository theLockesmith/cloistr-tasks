-- 023_column_is_done.sql
--
-- Cards have no done/closed state of their own: a card is "done" because of
-- the column it sits in. GET /api/cards (the cross-board list of a user's
-- cards) needs that rule to be explicit, so columns get an is_done flag.
--
-- Existing columns named Done, Closed or Complete (case-insensitive, trimmed)
-- are marked done. A toggle in the board UI follows separately.
--
-- Down: database/migrations/down/023_column_is_done.sql

ALTER TABLE board_columns
    ADD COLUMN IF NOT EXISTS is_done BOOLEAN NOT NULL DEFAULT false;

UPDATE board_columns
   SET is_done = true
 WHERE lower(trim(name)) IN ('done', 'closed', 'complete');
