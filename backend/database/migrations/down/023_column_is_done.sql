-- Reverses 023_column_is_done.sql. The migration runner only reads *.sql
-- directly in migrations/, so files here never run automatically. To roll
-- back, run this file and remove the row from the migrations table:
--   DELETE FROM migrations WHERE filename = '023_column_is_done.sql';

ALTER TABLE board_columns DROP COLUMN IF EXISTS is_done;
