-- 002_add_users_and_settings.sql
-- Add user management and per-user settings

-- Users table (synced from Keycloak)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY, -- Keycloak user ID (UUID)
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    timezone VARCHAR(50) DEFAULT 'UTC',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

-- User settings table
CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    reset_enabled BOOLEAN DEFAULT true,
    reset_time TIME DEFAULT '06:00:00', -- Daily reset time
    reset_timezone VARCHAR(50) DEFAULT 'UTC',
    reset_days VARCHAR(20) DEFAULT 'daily', -- 'daily', 'weekdays', 'weekends', 'custom'
    custom_reset_days INTEGER[], -- Array of weekdays (0=Sunday, 1=Monday, etc.)
    auto_create_tasks BOOLEAN DEFAULT true,
    theme VARCHAR(20) DEFAULT 'light', -- 'light', 'dark', 'auto'
    notification_email BOOLEAN DEFAULT false,
    notification_browser BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id)
);

-- Add user_id to existing tables
ALTER TABLE task_lists ADD COLUMN IF NOT EXISTS user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE task_lists ADD COLUMN IF NOT EXISTS shared BOOLEAN DEFAULT false;
ALTER TABLE task_lists ADD COLUMN IF NOT EXISTS shared_with TEXT[]; -- Array of user IDs

-- Create indexes for user-based queries
CREATE INDEX IF NOT EXISTS idx_task_lists_user ON task_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

-- Update triggers for user_settings
DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at 
    BEFORE UPDATE ON user_settings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- User reset schedules table (for complex scheduling)
CREATE TABLE IF NOT EXISTS user_reset_schedules (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    list_id INTEGER REFERENCES task_lists(id) ON DELETE CASCADE,
    schedule_name VARCHAR(100) NOT NULL,
    cron_expression VARCHAR(100), -- For complex schedules
    timezone VARCHAR(50) DEFAULT 'UTC',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, list_id, schedule_name)
);

-- Reset history table (track when resets occur)
CREATE TABLE IF NOT EXISTS reset_history (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
    list_id INTEGER REFERENCES task_lists(id) ON DELETE CASCADE,
    reset_date DATE NOT NULL,
    reset_time TIMESTAMP DEFAULT NOW(),
    tasks_created INTEGER DEFAULT 0,
    trigger_type VARCHAR(20) DEFAULT 'automatic', -- 'automatic', 'manual', 'scheduled'
    created_at TIMESTAMP DEFAULT NOW()
);

-- Function to get user's reset time in their timezone
CREATE OR REPLACE FUNCTION get_user_reset_time(user_uuid VARCHAR(36))
RETURNS TIMESTAMP WITH TIME ZONE AS $$
DECLARE
    user_settings_rec RECORD;
    reset_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Get user settings
    SELECT us.reset_time, us.reset_timezone, u.timezone
    INTO user_settings_rec
    FROM user_settings us
    JOIN users u ON us.user_id = u.id
    WHERE us.user_id = user_uuid;
    
    -- If no settings found, use defaults
    IF NOT FOUND THEN
        RETURN CURRENT_DATE::timestamp + INTERVAL '6 hours';
    END IF;
    
    -- Calculate next reset time in user's timezone
    reset_timestamp := (CURRENT_DATE + user_settings_rec.reset_time)::timestamp 
                      AT TIME ZONE COALESCE(user_settings_rec.reset_timezone, user_settings_rec.timezone, 'UTC');
    
    -- If the time has already passed today, schedule for tomorrow
    IF reset_timestamp <= NOW() THEN
        reset_timestamp := reset_timestamp + INTERVAL '1 day';
    END IF;
    
    RETURN reset_timestamp;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user should have reset today
CREATE OR REPLACE FUNCTION should_reset_today(user_uuid VARCHAR(36))
RETURNS BOOLEAN AS $$
DECLARE
    user_settings_rec RECORD;
    current_weekday INTEGER;
BEGIN
    -- Get user settings
    SELECT reset_enabled, reset_days, custom_reset_days
    INTO user_settings_rec
    FROM user_settings
    WHERE user_id = user_uuid;
    
    -- If no settings or reset disabled, return false
    IF NOT FOUND OR NOT user_settings_rec.reset_enabled THEN
        RETURN false;
    END IF;
    
    -- Get current weekday (0=Sunday, 1=Monday, etc.)
    current_weekday := EXTRACT(DOW FROM CURRENT_DATE);
    
    CASE user_settings_rec.reset_days
        WHEN 'daily' THEN
            RETURN true;
        WHEN 'weekdays' THEN
            RETURN current_weekday BETWEEN 1 AND 5; -- Monday to Friday
        WHEN 'weekends' THEN
            RETURN current_weekday IN (0, 6); -- Sunday and Saturday
        WHEN 'custom' THEN
            RETURN current_weekday = ANY(user_settings_rec.custom_reset_days);
        ELSE
            RETURN true; -- Default to daily
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to create today's tasks for a specific user
CREATE OR REPLACE FUNCTION create_user_tasks_for_today(user_uuid VARCHAR(36))
RETURNS INTEGER AS $
DECLARE
    tasks_created INTEGER := 0;
    list_record RECORD;
    insert_count INTEGER;
BEGIN
    -- Check if user should reset today
    IF NOT should_reset_today(user_uuid) THEN
        RETURN 0;
    END IF;
    
    -- Create tasks for each of the user's lists
    FOR list_record IN 
        SELECT id FROM task_lists WHERE user_id = user_uuid AND active = true
    LOOP
        INSERT INTO tasks (template_id, list_id, reset_date, created_at)
        SELECT tt.id, tt.list_id, CURRENT_DATE, NOW()
        FROM task_templates tt
        WHERE tt.list_id = list_record.id 
        AND tt.active = true
        AND NOT EXISTS (
            SELECT 1 FROM tasks t 
            WHERE t.template_id = tt.id 
            AND DATE(t.reset_date) = CURRENT_DATE
        );
        
        GET DIAGNOSTICS insert_count = ROW_COUNT;
        tasks_created := tasks_created + insert_count;
    END LOOP;
    
    -- Record the reset in history
    INSERT INTO reset_history (user_id, reset_date, tasks_created, trigger_type)
    VALUES (user_uuid, CURRENT_DATE, tasks_created, 'automatic');
    
    RETURN tasks_created;
END;
$ LANGUAGE plpgsql;

-- View for user tasks with settings
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

-- Comments
COMMENT ON TABLE users IS 'User accounts synced from Keycloak';
COMMENT ON TABLE user_settings IS 'Per-user configuration for task resets and preferences';
COMMENT ON TABLE user_reset_schedules IS 'Custom reset schedules for specific lists';
COMMENT ON TABLE reset_history IS 'Audit log of when task resets occurred';
COMMENT ON FUNCTION get_user_reset_time IS 'Calculate next reset time for a user in their timezone';
COMMENT ON FUNCTION should_reset_today IS 'Check if a user should have their tasks reset today';
COMMENT ON FUNCTION create_user_tasks_for_today IS 'Create daily tasks for a specific user based on their settings';