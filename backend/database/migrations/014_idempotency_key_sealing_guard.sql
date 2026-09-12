-- 014_idempotency_key_sealing_guard.sql
--
-- Documents a constraint that cannot be enforced by the schema alone:
-- columns used as idempotency / dedup keys MUST remain plaintext.
--
-- NIP-44 v2 encryption is non-deterministic (each seal carries a random
-- nonce).  Sealing the same plaintext twice produces different ciphertext.
-- A unique index over sealed values therefore never matches, and every
-- write inserts a new row instead of deduplicating.  The failure is
-- silent: the ciphertext fits the column width, no constraint fires, and
-- duplicates accumulate without error.
--
-- Measured 2026-09-12 by cloistr-ops:
--   same plaintext, same keypair, sealed twice -> identical ciphertext? False
--   (v2 carries a random nonce; both outputs were 176 bytes)
--
-- The general rule: a column whose value is MATCHED (unique index, WHERE
-- clause, JOIN key) must hold plaintext or a deterministic digest, never
-- sealed ciphertext.  A coord UUID is an opaque identifier and carries no
-- user content, so plaintext is appropriate here.
--
-- Columns covered:
--   board_cards.external_id      — idx_board_cards_external
--   board_cards.external_source  — idx_board_cards_external
--   card_comments.external_id   — idx_card_comments_external
--   card_comments.external_source — idx_card_comments_external
--
-- Also documents: card_comments.author_label remains VARCHAR(100)
-- deliberately.  It holds a session role_tag (e.g. 'cloistr-relay'),
-- not user content, and is never a candidate for sealing.  Its absence
-- from 012_widen_name_columns.sql was a decision, not an oversight.

-- Update column comments to include the sealing prohibition.

COMMENT ON COLUMN board_cards.external_id IS
  'Identifier in the source system (e.g. coord task UUID). '
  'MUST remain plaintext — NIP-44 v2 is non-deterministic, sealing '
  'this column would silently break the uniqueness index and produce '
  'one duplicate card per sweep, forever, with no error.';

COMMENT ON COLUMN board_cards.external_source IS
  'Source system name (e.g. coord). '
  'MUST remain plaintext — matched by the dedup index.';

COMMENT ON COLUMN card_comments.external_id IS
  'Identifier in the source system for bridge idempotency. '
  'MUST remain plaintext — NIP-44 v2 is non-deterministic, sealing '
  'this column would silently break the uniqueness index and produce '
  'one duplicate comment per sweep, forever, with no error.';

COMMENT ON COLUMN card_comments.external_source IS
  'Source system name (e.g. coord) for bridge idempotency. '
  'MUST remain plaintext — matched by the dedup index.';

COMMENT ON COLUMN card_comments.author_label IS
  'Session role_tag for provenance (e.g. cloistr-relay). Display only, '
  'never auth. VARCHAR(100) is deliberate: this is not user content and '
  'is never a candidate for sealing; its absence from 012 is a decision.';
