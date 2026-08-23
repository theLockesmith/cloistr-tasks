-- 007_add_subtasks.sql
-- Add sub-task support: a task_template can have a parent_template_id that
-- points to another template in the same list.  Only one level of nesting is
-- enforced by convention (the API rejects a parent that is itself a subtask).

ALTER TABLE task_templates
  ADD COLUMN IF NOT EXISTS parent_template_id INTEGER
    REFERENCES task_templates(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_task_templates_parent
  ON task_templates(parent_template_id)
  WHERE parent_template_id IS NOT NULL;

COMMENT ON COLUMN task_templates.parent_template_id IS
  'NULL = top-level task; non-NULL = sub-task of the referenced template';
