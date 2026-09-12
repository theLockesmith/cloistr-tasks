-- 012_widen_name_columns.sql
--
-- Widen name/title columns from VARCHAR(n) to TEXT.
--
-- NIP-44 v2 padding inflates every value: a 1-char plaintext becomes 132
-- bytes after sealing.  VARCHAR(100) overflows at ANY plaintext length,
-- and VARCHAR(500) holds only about 280 sealed chars.  TEXT is stored
-- identically by Postgres and has no index impact here (the only index
-- touching any of these columns is UNIQUE(user_id, name) on labels,
-- which remains safe with an application-level 2000-char cap well under
-- the btree page limit).
--
-- Columns widened:
--   task_lists.name        VARCHAR(100) -> TEXT
--   task_templates.name    VARCHAR(200) -> TEXT
--   board_columns.name     VARCHAR(100) -> TEXT
--   board_cards.title      VARCHAR(500) -> TEXT
--   labels.name            VARCHAR(50)  -> TEXT

ALTER TABLE task_lists      ALTER COLUMN name  TYPE TEXT;
ALTER TABLE task_templates  ALTER COLUMN name  TYPE TEXT;
ALTER TABLE board_columns   ALTER COLUMN name  TYPE TEXT;
ALTER TABLE board_cards     ALTER COLUMN title TYPE TEXT;
ALTER TABLE labels          ALTER COLUMN name  TYPE TEXT;
