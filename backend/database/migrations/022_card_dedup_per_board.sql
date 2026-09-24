-- One card per external entity PER BOARD, not per service.
--
-- WHY THIS CHANGES.
--
-- idx_board_cards_external was created in 011 as UNIQUE (external_source,
-- external_id) with no list_id. That is correct for the only client there was:
-- the coord mirror keys cards by coord task uuid, which is unique everywhere,
-- so a global index never collided.
--
-- It is wrong for a client whose key is not globally unique, and one is about
-- to ship. The card-creating hook keys on a hash of the instruction's extracted
-- title, with the same source name on every board. Two sessions in different
-- groups both saying "update the docs" produce the same key, and under a global
-- index the second one does not get a card: the insert violates the index and
-- the endpoint hands back THE FIRST GROUP'S CARD, from a board the caller
-- cannot see, title and description included.
--
-- That is the same class of defect already fixed for card_comments in 65770090
-- and regression-tested in tests/integration/board-defects.test.js, reached
-- here through a different door.
--
-- WHY CARDS GET PER-BOARD UNIQUENESS AND COMMENTS GET A REFUSAL.
--
-- The comment endpoint answers a cross-board collision with 409, because a
-- comment belongs to exactly one card and the same external id on two cards is
-- genuinely a mistake. A CARD is different: two groups each holding the same
-- instruction should each get their own card on their own board, and a 409
-- would mean the second group's work is silently never created. So the board
-- becomes part of the key rather than a thing to refuse over.
--
-- SAFE FOR EVERY EXISTING ROW. Adding a column to a unique key can only ever
-- permit more, never conflict: any set of rows unique on (source, id) is still
-- unique on (list_id, source, id). Existing coord-keyed cards are unaffected,
-- because a globally unique key stays unique when a board is added to it.

DROP INDEX IF EXISTS idx_board_cards_external;

CREATE UNIQUE INDEX IF NOT EXISTS idx_board_cards_external
    ON board_cards (list_id, external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

COMMENT ON COLUMN board_cards.external_id IS
    'Identifier in the source system (e.g. coord task UUID). Unique per BOARD, '
    'not per service: see migration 022. Must stay plaintext, see migration 014.';
