-- 018_board_activity.sql
--
-- Simple activity log for boards: who did what, when.  Logged from inside
-- the route handlers themselves (card create/move/delete, comment create)
-- rather than via middleware, so each entry can carry a precise, per-action
-- detail string.
--
-- card_id is nullable and ON DELETE SET NULL: a card's history should
-- outlive the card (e.g. the "deleted card X" entry itself), and a
-- board-level comment has no card at all.

CREATE TABLE IF NOT EXISTS board_activity (
    id            SERIAL PRIMARY KEY,
    list_id       INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
    card_id       INTEGER REFERENCES board_cards(id) ON DELETE SET NULL,
    actor_pubkey  VARCHAR(64) NOT NULL,
    action        VARCHAR(50) NOT NULL,
    detail        TEXT,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_activity_list
    ON board_activity (list_id, created_at DESC);

COMMENT ON TABLE board_activity IS 'Board activity log: card create/move/delete and comment creation, newest first';
COMMENT ON COLUMN board_activity.action IS 'Short action code, e.g. card_created, card_moved, card_deleted, comment_created';
COMMENT ON COLUMN board_activity.card_id IS 'Card the action targeted; NULL for board-level actions or after the card is deleted';
