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
--
-- The todays_tasks and user_tasks_today views reference task_lists.name
-- and task_templates.name.  Postgres blocks ALTER TYPE on a column used
-- by a view, so we drop both views, run the ALTERs, and recreate them.
-- Wrapped in a transaction so a failure leaves nothing half-applied.

BEGIN;

-- Drop views that depend on the columns we are altering.
DROP VIEW IF EXISTS user_tasks_today;
DROP VIEW IF EXISTS todays_tasks;

-- Widen the columns.
ALTER TABLE task_lists      ALTER COLUMN name  TYPE TEXT;
ALTER TABLE task_templates  ALTER COLUMN name  TYPE TEXT;
ALTER TABLE board_columns   ALTER COLUMN name  TYPE TEXT;
ALTER TABLE board_cards     ALTER COLUMN title TYPE TEXT;
ALTER TABLE labels          ALTER COLUMN name  TYPE TEXT;

-- Recreate todays_tasks (definition from 001_initial_schema.sql).
CREATE OR REPLACE VIEW todays_tasks AS
SELECT
    t.id,
    t.completed_at,
    t.notes,
    tt.name,
    tt.description,
    tt.time_slot,
    tt.estimated_minutes,
    tl.name as list_name,
    tl.icon as list_icon,
    tl.color as list_color,
    CASE WHEN t.completed_at IS NOT NULL THEN true ELSE false END as completed
FROM tasks t
JOIN task_templates tt ON t.template_id = tt.id
JOIN task_lists tl ON t.list_id = tl.id
WHERE DATE(t.reset_date) = CURRENT_DATE
ORDER BY tl.sort_order, tt.sort_order;

-- Recreate user_tasks_today (definition from 004_fix_user_id_length.sql).
CREATE OR REPLACE VIEW user_tasks_today AS
SELECT
    t.id,
    t.completed_at,
    t.notes,
    tt.name,
    tt.description,
    tt.time_slot,
    tt.estimated_minutes,
    tl.name as list_name,
    tl.icon as list_icon,
    tl.color as list_color,
    tl.user_id,
    u.username,
    us.reset_time,
    us.reset_timezone,
    CASE WHEN t.completed_at IS NOT NULL THEN true ELSE false END as completed
FROM tasks t
JOIN task_templates tt ON t.template_id = tt.id
JOIN task_lists tl ON t.list_id = tl.id
JOIN users u ON tl.user_id = u.id
LEFT JOIN user_settings us ON u.id = us.user_id
WHERE DATE(t.reset_date) = CURRENT_DATE
ORDER BY tl.sort_order, tt.sort_order;

COMMIT;
