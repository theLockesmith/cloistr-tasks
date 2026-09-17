-- 019_add_template_recurring_deadline.sql
-- Add a recurring time-of-day deadline to task_templates.
--
-- NOTE ON SCOPE: task_templates already has `priority` (VARCHAR: low/medium/
-- high, default 'medium') and `due_date` (a specific calendar DATE) — both
-- added in 005_add_task_priority_duedate.sql and already wired end-to-end
-- through the template CRUD endpoints and the Add/Edit task modals. Those
-- are NOT touched here.
--
-- recurring_deadline is a distinct concept: a time-of-day (e.g. "17:00")
-- that applies every day the recurring task is active, independent of
-- due_date (which is a one-time calendar date). It lets a daily habit like
-- "submit timesheet" carry a "by 5pm" expectation without needing a new
-- due_date every day.

ALTER TABLE task_templates
ADD COLUMN IF NOT EXISTS recurring_deadline VARCHAR(10);

COMMENT ON COLUMN task_templates.recurring_deadline IS
  'Time of day (HH:MM, 24h) by which this recurring task should be completed each day it is active. NULL means no deadline.';
