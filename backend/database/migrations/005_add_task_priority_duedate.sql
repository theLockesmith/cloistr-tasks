-- 005_add_task_priority_duedate.sql
-- Add priority and due_date fields to task_templates

-- Add priority column (low, medium, high)
ALTER TABLE task_templates
ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'medium';

-- Add due_date column for optional due dates
ALTER TABLE task_templates
ADD COLUMN IF NOT EXISTS due_date DATE;

-- Add index for due_date queries
CREATE INDEX IF NOT EXISTS idx_task_templates_due_date ON task_templates(due_date) WHERE due_date IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN task_templates.priority IS 'Task priority level: low, medium, or high';
COMMENT ON COLUMN task_templates.due_date IS 'Optional due date for the task';
