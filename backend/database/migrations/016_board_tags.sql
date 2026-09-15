-- Migration 016: Board-scoped tags.
--
-- Per-board shared vocabulary, distinct from the per-user labels table
-- (migration 008) used by the habit tracker.  Board tags are visible to
-- all collaborators and appear on the public endpoint alongside card titles.
--
-- Permission ladder:
--   admin+  can create, rename, recolor, delete tags (board shape)
--   write+  can attach/detach existing tags to cards (card editing)

CREATE TABLE IF NOT EXISTS board_tags (
  id          SERIAL PRIMARY KEY,
  list_id     INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#6b7280',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(list_id, name)
);

CREATE TABLE IF NOT EXISTS board_card_tags (
  card_id  INTEGER NOT NULL REFERENCES board_cards(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES board_tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_board_tags_list ON board_tags(list_id);
CREATE INDEX IF NOT EXISTS idx_board_card_tags_tag ON board_card_tags(tag_id);
