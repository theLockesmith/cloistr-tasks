-- 011_board_model.sql
--
-- Adds a Trello-like board model alongside the existing habit tracker.
--
-- A board is a task_list with list_type = 'board'.  It reuses task_lists for
-- ownership, task_list_shares for sharing, and the existing access helpers.
--
-- Three new tables:
--   board_columns   — stages within a board (left-to-right workflow)
--   board_cards     — persistent work items (not template instances)
--   card_comments   — flat discussion on a card
--
-- Column creation is owner-only.  A write-access mirror (the fleet bridge)
-- can create cards, move cards between existing columns, and post comments,
-- but cannot create or delete columns.
--
-- The habit model (task_templates, tasks, reset_date, todays_tasks,
-- create_todays_tasks, create_user_tasks_for_today) is untouched.

-- ── Board columns ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS board_columns (
    id          SERIAL PRIMARY KEY,
    list_id     INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7),
    sort_order  INTEGER DEFAULT 0,
    collapsed   BOOLEAN DEFAULT false,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_board_columns_list
    ON board_columns (list_id, sort_order);

DROP TRIGGER IF EXISTS update_board_columns_updated_at ON board_columns;
CREATE TRIGGER update_board_columns_updated_at
    BEFORE UPDATE ON board_columns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Board cards ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS board_cards (
    id               SERIAL PRIMARY KEY,
    column_id        INTEGER NOT NULL REFERENCES board_columns(id) ON DELETE CASCADE,
    list_id          INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
    title            VARCHAR(500) NOT NULL,
    description      TEXT,
    priority         INTEGER DEFAULT 3 CHECK (priority BETWEEN 1 AND 10),
    due_date         DATE,
    author_pubkey    VARCHAR(64) NOT NULL,
    assignee_pubkey  VARCHAR(64),
    sort_order       INTEGER DEFAULT 0,
    external_id      VARCHAR(200),
    external_source  VARCHAR(50),
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
);

-- One card per external entity (e.g. one card per coord task UUID).
-- Nulls are excluded from uniqueness, so hand-created cards are unrestricted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_cards_external
    ON board_cards (external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_board_cards_column
    ON board_cards (column_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_board_cards_list
    ON board_cards (list_id);

CREATE INDEX IF NOT EXISTS idx_board_cards_assignee
    ON board_cards (assignee_pubkey)
    WHERE assignee_pubkey IS NOT NULL;

DROP TRIGGER IF EXISTS update_board_cards_updated_at ON board_cards;
CREATE TRIGGER update_board_cards_updated_at
    BEFORE UPDATE ON board_cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Card comments ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS card_comments (
    id               SERIAL PRIMARY KEY,
    card_id          INTEGER NOT NULL REFERENCES board_cards(id) ON DELETE CASCADE,
    author_pubkey    VARCHAR(64) NOT NULL,
    author_label     VARCHAR(100),
    body             TEXT NOT NULL,
    external_source  VARCHAR(50),
    external_id      VARCHAR(200),
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
);

-- One comment per external entity (e.g. one mirrored coord message per card).
-- Nulls are excluded from uniqueness, so human comments are unrestricted.
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_comments_external
    ON card_comments (external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_card_comments_card
    ON card_comments (card_id, created_at);

DROP TRIGGER IF EXISTS update_card_comments_updated_at ON card_comments;
CREATE TRIGGER update_card_comments_updated_at
    BEFORE UPDATE ON card_comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Documentation ───────────────────────────────────────────────────────

COMMENT ON TABLE board_columns IS 'Workflow stages within a board-type task_list (left-to-right). Owner-only creation.';
COMMENT ON TABLE board_cards IS 'Persistent work items on a board (not daily template instances)';
COMMENT ON TABLE card_comments IS 'Flat discussion thread on a board card';

COMMENT ON COLUMN board_cards.external_id IS 'Identifier in the source system (e.g. coord task UUID)';
COMMENT ON COLUMN board_cards.external_source IS 'Source system name (e.g. coord)';
COMMENT ON COLUMN board_cards.priority IS '1 = P1/highest, 10 = P10/lowest — matches coord priority range';
COMMENT ON COLUMN board_columns.collapsed IS 'Whether the column is visually collapsed in the UI';
COMMENT ON COLUMN card_comments.author_label IS 'Session role_tag for provenance (e.g. cloistr-relay); display only, never auth';
COMMENT ON COLUMN card_comments.external_source IS 'Source system name (e.g. coord) for bridge idempotency';
COMMENT ON COLUMN card_comments.external_id IS 'Identifier in the source system for bridge idempotency';
