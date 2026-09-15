-- Card checklist items: real rows, not markdown checkboxes.
-- Write access ticks items; admin/owner manages (create/delete/reorder).
CREATE TABLE IF NOT EXISTS card_checklist_items (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES board_cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_card ON card_checklist_items(card_id);
