-- 013_board_comments_threading_visibility.sql
--
-- Three additions to the board model:
--
-- 1. BOARD-LEVEL COMMENTS -- card_id becomes nullable.  A comment with
--    card_id IS NULL is a board-level comment, not a card comment.
--    list_id is added (NOT NULL after backfill) so board comments know
--    which board they belong to.  The ON DELETE CASCADE on card_id is
--    unaffected: NULL card_id rows are not touched by card deletion.
--
-- 2. THREADED REPLIES -- a nullable self-reference (parent_comment_id)
--    on card_comments.  ON DELETE SET NULL: if a parent is force-removed,
--    orphaned replies keep their position.  Normal deletion tombstones
--    (sets deleted_at + clears body) so the reply chain stays intact.
--
-- 3. PUBLIC/PRIVATE VISIBILITY -- a visibility column on task_lists.
--    Default 'private'.  Only boards may be public (CHECK constraint).
--    'public' means unauthenticated-readable for columns and cards.
--    Comments stay gated behind authentication regardless of board
--    visibility, because a toggle should not retroactively publish
--    every comment written while the board was private.

-- ── Board-level comments ────────────────────────────────────────────────

-- Add list_id so board-level comments know which board they belong to.
ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS list_id INTEGER
    REFERENCES task_lists(id) ON DELETE CASCADE;

-- Backfill list_id from the card's list_id for all existing comments.
UPDATE card_comments cc
SET list_id = bc.list_id
FROM board_cards bc
WHERE cc.card_id = bc.id AND cc.list_id IS NULL;

-- Now make list_id NOT NULL (all rows have been backfilled).
ALTER TABLE card_comments ALTER COLUMN list_id SET NOT NULL;

-- Make card_id nullable (was NOT NULL).  Comments with card_id IS NULL
-- are board-level comments.
ALTER TABLE card_comments ALTER COLUMN card_id DROP NOT NULL;

-- Index for board-level comment listing (only comments without a card).
CREATE INDEX IF NOT EXISTS idx_card_comments_list
    ON card_comments (list_id, created_at)
    WHERE card_id IS NULL;

-- ── Threaded replies ────────────────────────────────────────────────────
-- ON DELETE SET NULL (not CASCADE): deleting a parent must not destroy
-- replies written by other authors.  The server tombstones parents that
-- have children (blanks body, sets deleted_at) rather than removing them,
-- so this FK action is a safety net for hard deletes of leaves.

ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS parent_comment_id INTEGER
    REFERENCES card_comments(id) ON DELETE SET NULL;

-- deleted_at supports tombstoning: a comment with replies keeps its row
-- with body cleared and deleted_at set so the thread structure survives.
ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- ── Public/private board visibility ─────────────────────────────────────
-- Only boards may be public (chk_visibility_board_only).  This prevents
-- personal habit lists from being toggled public by accident.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_lists' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE task_lists ADD COLUMN visibility VARCHAR(10) NOT NULL DEFAULT 'private';
    ALTER TABLE task_lists ADD CONSTRAINT chk_visibility_values
      CHECK (visibility IN ('private', 'public'));
    ALTER TABLE task_lists ADD CONSTRAINT chk_visibility_board_only
      CHECK (visibility = 'private' OR list_type = 'board');
  END IF;
END
$$;
