-- 001_initial_schema.sql
-- Initial database schema for Task Manager

-- Task Lists (Morning Routine, Work Tasks, etc.)
CREATE TABLE IF NOT EXISTS task_lists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(10) DEFAULT '📋',
    color VARCHAR(7) DEFAULT '#3b82f6',
    sort_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Task Templates (the repeatable tasks)
CREATE TABLE IF NOT EXISTS task_templates (
    id SERIAL PRIMARY KEY,
    list_id INTEGER REFERENCES task_lists(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    time_slot VARCHAR(20), -- e.g., "8:30", "morning", "afternoon"
    estimated_minutes INTEGER,
    sort_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Daily Task Instances (created from templates each day)
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES task_templates(id) ON DELETE CASCADE,
    list_id INTEGER REFERENCES task_lists(id) ON DELETE CASCADE,
    reset_date DATE NOT NULL, -- which day this task instance belongs to
    completed_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure one task instance per template per day
    UNIQUE(template_id, reset_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_list_date ON tasks(list_id, reset_date);
CREATE INDEX IF NOT EXISTS idx_tasks_template_date ON tasks(template_id, reset_date);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_templates_list ON task_templates(list_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_task_lists_sort ON task_lists(sort_order);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update timestamps
DROP TRIGGER IF EXISTS update_task_lists_updated_at ON task_lists;
CREATE TRIGGER update_task_lists_updated_at 
    BEFORE UPDATE ON task_lists 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_templates_updated_at ON task_templates;
CREATE TRIGGER update_task_templates_updated_at 
    BEFORE UPDATE ON task_templates 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at 
    BEFORE UPDATE ON tasks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for today's tasks with completion status
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

-- Function to create today's tasks from templates
CREATE OR REPLACE FUNCTION create_todays_tasks()
RETURNS INTEGER AS $$
DECLARE
    tasks_created INTEGER := 0;
BEGIN
    INSERT INTO tasks (template_id, list_id, reset_date)
    SELECT tt.id, tt.list_id, CURRENT_DATE
    FROM task_templates tt
    WHERE tt.active = true
    AND NOT EXISTS (
        SELECT 1 FROM tasks t 
        WHERE t.template_id = tt.id 
        AND DATE(t.reset_date) = CURRENT_DATE
    );
    
    GET DIAGNOSTICS tasks_created = ROW_COUNT;
    RETURN tasks_created;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE task_lists IS 'Different categories of tasks (Morning, Work, Evening, etc.)';
COMMENT ON TABLE task_templates IS 'Reusable task definitions that create daily instances';
COMMENT ON TABLE tasks IS 'Daily task instances created from templates';
COMMENT ON COLUMN tasks.reset_date IS 'The date this task instance was created for';
COMMENT ON COLUMN task_templates.time_slot IS 'When this task should be done (8:30, morning, etc.)';
COMMENT ON COLUMN task_templates.estimated_minutes IS 'How long this task typically takes';
COMMENT ON VIEW todays_tasks IS 'All tasks for the current date with completion status';
COMMENT ON FUNCTION create_todays_tasks IS 'Creates task instances for today from active templates';