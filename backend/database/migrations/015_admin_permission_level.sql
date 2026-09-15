-- Migration 015: Add admin permission level to task_list_shares.
--
-- Admin sits between write and owner in the hierarchy:
--   read(1) < write(2) < admin(3) < owner(4)
--
-- Admin can: view/create/remove shares, rename the board, manage columns,
-- and change board settings.
-- Owner keeps: deleting the board and transferring ownership.
--
-- Owner staying singular (a column on task_lists, not a row in shares)
-- makes "a board with zero owners" impossible by construction rather than
-- a rule enforced on every removal path.

ALTER TABLE task_list_shares
  DROP CONSTRAINT IF EXISTS task_list_shares_permission_check;

ALTER TABLE task_list_shares
  ADD CONSTRAINT task_list_shares_permission_check
  CHECK (permission IN ('read', 'write', 'admin'));
