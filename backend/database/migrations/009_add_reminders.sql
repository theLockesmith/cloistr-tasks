-- 009_add_reminders.sql
-- Add a reminder_offset_minutes column to task_templates.
-- When non-null and the template has a due_date, the frontend displays
-- a "remind N minutes before due" indicator and can schedule a browser
-- Notification via the Web Notifications API.

ALTER TABLE task_templates
  ADD COLUMN IF NOT EXISTS reminder_offset_minutes INTEGER;

COMMENT ON COLUMN task_templates.reminder_offset_minutes IS
  'Minutes before due_date/time_slot to show a reminder; NULL = no reminder';
