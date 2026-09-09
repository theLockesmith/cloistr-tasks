-- 010_list_sharing.sql
--
-- Adds list sharing: a join table (task_list_shares) that grants read or write
-- access to a list by pubkey.  Also drops the dead shared/shared_with columns
-- from task_lists (added in 002, never read by any code).

-- Drop dead columns
ALTER TABLE task_lists DROP COLUMN IF EXISTS shared;
ALTER TABLE task_lists DROP COLUMN IF EXISTS shared_with;

-- Share grants: one row per (list, pubkey, permission).
CREATE TABLE IF NOT EXISTS task_list_shares (
  id          SERIAL PRIMARY KEY,
  list_id     INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  pubkey      VARCHAR(64) NOT NULL,
  permission  VARCHAR(10) NOT NULL DEFAULT 'read'
              CHECK (permission IN ('read', 'write')),
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (list_id, pubkey)
);

-- Fast lookup by pubkey (the shared-with user listing their shared lists).
CREATE INDEX IF NOT EXISTS idx_task_list_shares_pubkey ON task_list_shares (pubkey);
CREATE INDEX IF NOT EXISTS idx_task_list_shares_list   ON task_list_shares (list_id);
