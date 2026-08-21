-- 006_add_list_recurrence_fields.sql
-- Add per-list recurrence configuration to task_lists.
--
-- The frontend (AddListModal, EditListModal) has always collected list_type,
-- reset_enabled, reset_time, reset_days, and custom_reset_days from the user
-- and submitted them to POST/PUT /api/lists.  The backend silently discarded
-- them because the table had no columns for these fields.  This migration adds
-- the missing columns so the settings are preserved.

ALTER TABLE task_lists
  ADD COLUMN IF NOT EXISTS list_type        VARCHAR(20)  DEFAULT 'recurring',
  ADD COLUMN IF NOT EXISTS reset_enabled    BOOLEAN      DEFAULT true,
  ADD COLUMN IF NOT EXISTS reset_time       TIME         DEFAULT '06:00:00',
  ADD COLUMN IF NOT EXISTS reset_days       VARCHAR(20)  DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS custom_reset_days TEXT[]      DEFAULT '{}';

-- Update create_user_tasks_for_today to respect list_type.
--
-- Completion lists (list_type = 'completion') should NOT re-create a task
-- instance for any template that has already been completed at least once.
-- Recurring lists behave as before.
CREATE OR REPLACE FUNCTION create_user_tasks_for_today(user_uuid VARCHAR(36))
RETURNS INTEGER AS $$
DECLARE
    total_created INTEGER;
BEGIN
    -- Respect the per-user global reset schedule (unchanged logic).
    IF NOT should_reset_today(user_uuid) THEN
        RETURN 0;
    END IF;

    WITH inserted_tasks AS (
        INSERT INTO tasks (template_id, list_id, reset_date, created_at)
        SELECT tt.id, tt.list_id, CURRENT_DATE, NOW()
        FROM task_templates tt
        JOIN task_lists tl ON tt.list_id = tl.id
        WHERE tl.user_id = user_uuid
          AND tt.active  = true
          AND tl.active  = true
          -- Never create a duplicate instance for today.
          AND NOT EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.template_id = tt.id
                AND DATE(t.reset_date) = CURRENT_DATE
          )
          -- For completion lists: skip templates that were completed on any
          -- previous day.  Recurring lists have no such restriction.
          AND NOT (
              tl.list_type = 'completion'
              AND EXISTS (
                  SELECT 1 FROM tasks t2
                  WHERE t2.template_id = tt.id
                    AND t2.completed_at IS NOT NULL
                    AND DATE(t2.reset_date) < CURRENT_DATE
              )
          )
        RETURNING id
    )
    SELECT COUNT(*) INTO total_created FROM inserted_tasks;

    IF total_created > 0 THEN
        INSERT INTO reset_history (user_id, reset_date, tasks_created, trigger_type)
        VALUES (user_uuid, CURRENT_DATE, total_created, 'automatic');
    END IF;

    RETURN COALESCE(total_created, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN task_lists.list_type         IS 'recurring (resets daily) or completion (tasks stay done once checked)';
COMMENT ON COLUMN task_lists.reset_enabled     IS 'Whether automatic reset is enabled for this list';
COMMENT ON COLUMN task_lists.reset_time        IS 'Local time at which this list resets';
COMMENT ON COLUMN task_lists.reset_days        IS 'daily | weekdays | weekends | custom';
COMMENT ON COLUMN task_lists.custom_reset_days IS 'Day names for custom schedule, e.g. {monday,wednesday}';
