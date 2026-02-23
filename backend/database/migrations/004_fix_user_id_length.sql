-- 004_fix_user_id_length.sql
-- Fix user id column length to accommodate Nostr pubkeys (64-char hex)

-- Drop view that depends on users.id before altering column type
DROP VIEW IF EXISTS user_tasks_today;

-- Expand id column from VARCHAR(36) to VARCHAR(64)
ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(64);

-- Also need to update foreign key references
ALTER TABLE user_settings ALTER COLUMN user_id TYPE VARCHAR(64);
ALTER TABLE task_lists ALTER COLUMN user_id TYPE VARCHAR(64);
ALTER TABLE user_reset_schedules ALTER COLUMN user_id TYPE VARCHAR(64);
ALTER TABLE reset_history ALTER COLUMN user_id TYPE VARCHAR(64);

-- Update auth_challenges used_by column to match
ALTER TABLE auth_challenges ALTER COLUMN used_by TYPE VARCHAR(64);

-- Drop and recreate functions with updated parameter types
DROP FUNCTION IF EXISTS get_user_reset_time(VARCHAR(36));
DROP FUNCTION IF EXISTS should_reset_today(VARCHAR(36));
DROP FUNCTION IF EXISTS create_user_tasks_for_today(VARCHAR(36));

-- Function to get user's reset time in their timezone
CREATE OR REPLACE FUNCTION get_user_reset_time(user_uuid VARCHAR(64))
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
CREATE OR REPLACE FUNCTION should_reset_today(user_uuid VARCHAR(64))
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
CREATE OR REPLACE FUNCTION create_user_tasks_for_today(user_uuid VARCHAR(64))
RETURNS INTEGER AS $$
DECLARE
    total_created INTEGER;
BEGIN
    -- Check if user should reset today
    IF NOT should_reset_today(user_uuid) THEN
        RETURN 0;
    END IF;

    -- Create tasks from all active templates for this user
    WITH inserted_tasks AS (
        INSERT INTO tasks (template_id, list_id, reset_date, created_at)
        SELECT tt.id, tt.list_id, CURRENT_DATE, NOW()
        FROM task_templates tt
        JOIN task_lists tl ON tt.list_id = tl.id
        WHERE tl.user_id = user_uuid
        AND tt.active = true
        AND tl.active = true
        AND NOT EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.template_id = tt.id
            AND DATE(t.reset_date) = CURRENT_DATE
        )
        RETURNING id
    )
    SELECT COUNT(*) INTO total_created FROM inserted_tasks;

    -- Record the reset in history if tasks were created
    IF total_created > 0 THEN
        INSERT INTO reset_history (user_id, reset_date, tasks_created, trigger_type)
        VALUES (user_uuid, CURRENT_DATE, total_created, 'automatic');
    END IF;

    RETURN COALESCE(total_created, 0);
END;
$$ LANGUAGE plpgsql;

-- Recreate the view with updated column types
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

COMMENT ON COLUMN users.id IS 'User ID - Nostr pubkey (64-char hex) or legacy Keycloak UUID';
