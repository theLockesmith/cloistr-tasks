# Design: Nostr-Native Boards

**Status:** Design for operator review.
**Date:** 2026-09-16 (revised; original 2026-09-12)
**Author:** cloistr-tasks session
**Revision note:** Updated to address the 7 questions from coord task 2e04f911,
fill ordering and multi-author gaps, and incorporate features shipped since the
original (board tags, checklists, card filters).

## Why this reversal is deliberate

The app's CLAUDE.md argues against Nostr-native storage under "Why Not
Nostr-Native Storage?" with three reasons: losing query capabilities, adding
complexity without proportional benefit, and using relays as dumb blob storage.

Those reasons are not wrong. This design answers each one by name (see
"Addressing the original objections" at the end). But the operator is
overriding the conclusion, and for a reason that outweighs them: a productivity
suite whose thesis is "you own your data and can leave with everything" cannot
keep its task data in a private database that no other client can read.

## What moves, what stays

| Data              | Today      | After              | Why                                    |
|-------------------|------------|--------------------|----------------------------------------|
| Board structure   | PostgreSQL | Nostr events       | Collaborative, portable, can be public |
| Board cards       | PostgreSQL | Nostr events       | Same                                   |
| Card comments     | PostgreSQL | Nostr events       | Same                                   |
| Board tags        | PostgreSQL | Nostr events       | Board-scoped, collaborative            |
| Card checklists   | PostgreSQL | Nostr events       | Card-scoped, collaborative             |
| Board access      | task_list_shares | Event tags    | Replaced by member tags on board event |
| Personal tasks    | PostgreSQL | PostgreSQL         | Private, query-heavy, no sharing       |
| Habits/routines   | PostgreSQL | PostgreSQL         | Template/instance/reset-date model has no natural event equivalent |
| User settings     | PostgreSQL | PostgreSQL         | Per-user, not collaborative            |
| Labels (habits)   | PostgreSQL | PostgreSQL         | NIP-44 non-determinism breaks dedup (see migration 014 constraint) |

The habit tracker stays in PostgreSQL. It is the operator's daily routine
data, not shared, not public, and its template-instance-date model would be
forced into events with no gain. Touching it requires a deliberate, separate
decision.

---

## 1. Event model

All board entities use parameterized replaceable events (NIP-33, kind
30000-39999) except comments, which are regular events.

### The multi-author problem and how this design handles it

In Nostr, a parameterized replaceable event can only be replaced by the same
pubkey + kind + d-tag. If user A creates a card, only user A can update it.
But boards are collaborative: user B needs to move user A's card between
columns, toggle checklist items, and assign tags.

This design splits card data into two event kinds:

- **Card content** (kind 30302): title, description, priority, due date,
  checklist definitions. Signed by the card's author. Only the author can
  edit these fields.
- **Card state** (kind 30303): column assignment, sort key, assignee, tag
  attachments, checklist toggle states. Signed by whoever last changed the
  card's state. Any write-level collaborator can publish.

For card state, the relay stores one 30303 event per (pubkey, d-tag) pair.
When user A moves a card, then user B moves it, the relay holds both events.
The application picks the one with the latest `created_at` across all pubkeys.
This is last-write-wins at the application layer, not the protocol layer.

**Concurrent edit trade-off:** If two collaborators update different aspects
of the same card's state simultaneously (one moves it, one toggles a
checklist item), the later event is a complete snapshot that overwrites the
earlier one. The earlier change is lost. This is the same trade Nostr makes
everywhere (last-write-wins on replaceable events). Mitigation: the UI shows
a notification when a newer state event arrives from another pubkey, allowing
the user to re-apply their change.

### Board definition: kind 30301

Signed by the board owner. Contains board metadata, column definitions, tag
vocabulary, and the collaborator list.

```json
{
  "kind": 30301,
  "tags": [
    ["d", "<board-uuid>"],
    ["title", "Sprint Board"],
    ["description", "Current sprint work"],
    ["visibility", "public"],
    ["col", "<col-uuid>", "To Do", "#3b82f6"],
    ["col", "<col-uuid>", "In Progress", "#f59e0b"],
    ["col", "<col-uuid>", "Done", "#22c55e"],
    ["tag", "<tag-uuid>", "bug", "#ef4444"],
    ["tag", "<tag-uuid>", "feature", "#3b82f6"],
    ["member", "<pubkey-hex>", "admin"],
    ["member", "<pubkey-hex>", "write"],
    ["member", "<pubkey-hex>", "read"]
  ],
  "content": ""
}
```

Columns are embedded as ordered tags. Column order is the tag order in the
event. Adding, removing, or reordering columns means the owner publishes a
new board event. This makes column reorder atomic with any other board
metadata change.

Board tags (the shared vocabulary from migration 016) are also embedded.
Tag definitions are board-level (admin creates them), and the board event is
the natural home.

Member tags replace `task_list_shares`. Permission levels: `read`, `write`,
`admin`. The `owner` level is implicit (the event's author pubkey). Only the
owner can update the board event, so only the owner controls who has access.
This matches the current model where only the owner can grant/revoke admin.

**Who can update:** Owner only (they sign the event). This means an admin
who wants to rename the board or add a column must ask the owner, either
through the API (server requests the owner's signer) or by convention. For
the fleet board, the fleet bridge IS the owner and is always online, so
admin requests are served immediately.

### Card content: kind 30302

Signed by the card author.

```json
{
  "kind": 30302,
  "tags": [
    ["d", "<card-uuid>"],
    ["a", "30301:<board-owner-pubkey>:<board-uuid>"],
    ["external", "coord", "<coord-task-uuid>"],
    ["checklist", "<item-uuid>", "Write migration SQL"],
    ["checklist", "<item-uuid>", "Update access.js"],
    ["checklist", "<item-uuid>", "Add tests"]
  ],
  "content": "{\"title\":\"Fix login timeout\",\"description\":\"Detailed description here\",\"priority\":3,\"due_date\":\"2026-09-15\"}"
}
```

The `a` tag ties the card to its board. The `external` tag provides bridge
idempotency (replaces the PostgreSQL unique index on external_source,
external_id). Checklist item definitions (text and order) are tags on this
event, controlled by the card author.

Content is JSON for structured fields. For private boards, this JSON is
NIP-44 encrypted.

**Who can update:** Card author only (they sign the event). Other
collaborators edit card state (column, assignee, etc.) via kind 30303.

### Card state: kind 30303

Signed by whoever last changed the card's placement or collaborative state.

```json
{
  "kind": 30303,
  "tags": [
    ["d", "30302:<card-author-pubkey>:<card-uuid>"],
    ["a", "30301:<board-owner-pubkey>:<board-uuid>"],
    ["col", "<col-uuid>"],
    ["sort", "aK"],
    ["assignee", "<pubkey-hex>"],
    ["card-tag", "<tag-uuid>"],
    ["card-tag", "<tag-uuid>"],
    ["check-done", "<checklist-item-uuid>"],
    ["check-done", "<checklist-item-uuid>"]
  ],
  "content": ""
}
```

The d-tag is the card's event address, so all state events for the same
card share a d-tag. The relay stores one per (pubkey, kind, d-tag). The
application picks the latest across all pubkeys by `created_at`.

`sort` uses fractional indexing (see Ordering below). `card-tag` tags list
which board tags are attached. `check-done` tags list which checklist items
are completed (absence = not done).

**Who can update:** Any write-level collaborator.

### Card comment: kind 1111 (NIP-22)

Regular events (not replaceable). Immutable once published.

```json
{
  "kind": 1111,
  "tags": [
    ["K", "30302"],
    ["E", "<card-event-id>", "", "<card-author-pubkey>"],
    ["A", "30302:<card-author-pubkey>:<card-uuid>"],
    ["parent", "<parent-comment-event-id>"]
  ],
  "content": "Comment body text"
}
```

NIP-22 comment conventions with uppercase tags for root references. The
optional `parent` tag enables threading (replaces `parent_comment_id`).

Deletion uses NIP-09 (kind 5 deletion request). Tombstoning (clearing body
while preserving thread structure) is a kind 5 event: the relay may or may
not honor it, so the application treats a deleted comment as "[deleted]"
in the thread.

Board-level comments (card_id IS NULL in current schema) use the board's
event address instead of a card's in the `A` tag.

---

## 2. Ordering

**Decision: fractional indexing.**

The current schema uses `sort_order INTEGER`. Two clients reordering the same
board concurrently is not a corner case; it is the fleet bridge and the
operator on the same shared board. Integer sort order requires renumbering
other items on insert, which means updating multiple events atomically.
Nostr has no transactions.

Fractional indexing uses lexicographically ordered strings. To insert between
items with keys `"a"` and `"b"`, generate a key between them (e.g., `"aV"`).
Each card's sort key lives in its own card-state event (kind 30303). No global
order list exists to contend over.

**Concurrent insert behavior:** Two clients inserting between the same two
items each generate a different fractional key. Both events are accepted by
the relay. Both cards appear in the gap, in the order their keys sort. No
conflict, no data loss.

**Concurrent reorder behavior:** If two clients reorder the same card
simultaneously, each publishes a card-state event. Last-write-wins by
`created_at`. One reorder is lost. This is acceptable: reordering the same
card at the same instant is genuinely concurrent and one outcome must win.

**Column ordering** stays as tag order in the board event (kind 30301).
Column reorder is owner-only, so there is exactly one signer, and no
concurrent-edit problem.

**Library:** `fractional-indexing` (npm) or equivalent. Pure string
generation, no runtime dependencies.

---

## 3. What Postgres becomes

Postgres becomes a **read-side projection**: a queryable index rebuilt from
events, not the record of truth.

| Layer    | Role                                  | Authoritative? |
|----------|---------------------------------------|----------------|
| Relay    | Event storage, subscription delivery  | Yes            |
| Postgres | Queryable index for filtering/search  | No (derived)   |
| Client   | Decrypts, renders, publishes events   | N/A            |

**What is derived (rebuildable from relay):**
- Board metadata (name, description, columns, tags, members)
- Card content (title, description, priority, due date, checklists)
- Card state (column, sort key, assignee, tag attachments, checklist toggles)
- Comments (body, threading, timestamps)
- All access control (member tags on board events)

**What is NOT derivable from events (stays authoritative in Postgres):**
- Habit tracker data (task_lists with list_type != 'board', task_templates, tasks)
- User settings
- Per-user labels (NIP-44 dedup constraint)
- JWT sessions and auth challenges

**Rebuild-from-relay procedure:**
1. Subscribe to all board events (kinds 30301, 30302, 30303, 1111) for the
   known board addresses
2. Truncate the board projection tables
3. Re-ingest events in timestamp order, applying the same aggregation logic
   the live subscription uses
4. Verify counts match

The server maintains the projection by subscribing to the relay via WebSocket
(REQ filters on the board kinds). On startup, it does a full sync. During
operation, it processes events as they arrive. The existing Express API
continues to serve the frontend from the projection, so the frontend does not
need to speak Nostr directly in Phase 1.

---

## 4. Query

The CLAUDE.md objection is correct: relays cannot filter encrypted content.

### Public boards

Relay-side filtering works for structured queries:
- By board: filter on `#a` tag (board address)
- By column: filter on `#col` tag
- By author/assignee: filter on pubkey or `#assignee` tag
- By kind: 30302 for cards, 1111 for comments

Complex queries (full-text search across titles and descriptions, multi-field
filters like "assignee X in column Y with tag Z") run against the Postgres
projection. The relay is the record; Postgres is the search index.

Card filters already shipped (text/assignee/opener/tag, with URL state for
shareable views). These continue to work against the projection unchanged.

### Private boards

Events are encrypted. The relay stores opaque blobs. Two options:

**Option A: Server-side projection (requires key custody).**
The server holds a signer grant or a board-specific decryption key. It
decrypts incoming events, writes plaintext into the projection, and serves
queries from there. Filtering, search, and the board views work exactly as
they do today.

Cost: the server can read all private board content. This is the custody
model the app was built to avoid.

**Option B: Client-side decryption (no custody, limited query).**
The browser holds the signer (NIP-07 or NIP-46). It subscribes to the relay
directly, decrypts events, and builds a local index (IndexedDB or in-memory).
Filtering happens client-side. The server never sees plaintext.

Cost: no server-side notifications, no server-side search across boards,
slower initial load (decrypt every event on open). The bridge cannot read
private boards it does not own (it has no grant for the operator's key).

**Recommendation:** Option B for user-owned private boards (preserves the
security model), Option A only if the operator explicitly authorizes server-
side custody. For the fleet board specifically, the bridge owns it and can
decrypt its own events locally, so Option A applies naturally without
additional custody grants.

---

## 5. Sharing

Current model: `task_list_shares(list_id, pubkey, permission)` with
`listAccess()` resolving the caller's level.

Nostr model: `member` tags on the board event (kind 30301) carry pubkey and
permission level. The board owner controls the member list by publishing
updated board events.

| Operation                  | PostgreSQL                        | Nostr                                  |
|----------------------------|-----------------------------------|----------------------------------------|
| Grant read                 | INSERT into task_list_shares      | Owner adds `["member", pubkey, "read"]` tag |
| Grant write                | INSERT with permission='write'    | Owner adds `["member", pubkey, "write"]` tag |
| Grant admin                | INSERT with permission='admin'    | Owner adds `["member", pubkey, "admin"]` tag |
| Revoke                     | DELETE from task_list_shares      | Owner publishes without that member tag |
| Check access               | listAccess() SQL join             | Client checks: am I author or in a member tag? |
| Transfer ownership         | UPDATE task_lists.user_id         | Current owner re-signs the board event from the new owner's key (requires coordination) |

**Transfer ownership** is harder in Nostr than in Postgres. Changing the
event author requires the new owner to sign a new board event with the same
d-tag. The old owner cannot do this (wrong key). The transfer must be a
two-step protocol: old owner publishes a "transfer-intent" event, new owner
reads it and publishes the replacement board event. Until the new owner acts,
the old board event is still the latest. This needs explicit design before
implementation.

**For the fleet board specifically:** The fleet bridge owns board 98. The
operator has write access. Shipping admin changes the member tag to
`["member", "<operator-pubkey>", "admin"]`. The bridge publishes the updated
board event. No transfer needed.

### Relay write whitelist (precondition)

The hosted relay (`wss://relay.cloistr.xyz`) enforces a write whitelist.
Only 5 pubkeys may publish events. A non-whitelisted user cannot create
boards, cards, or comments on this relay.

This design does not decide whether to widen the whitelist. That is a
security-posture decision for the operator. It is named here as a
precondition: Phase 1 is unreachable for any user not on the whitelist
unless the policy changes. Coord task `6688f453` covers the same question
from the threads side.

---

## 6. Migration

### The two models do NOT move together

The habit tracker (task_lists with list_type != 'board', task_templates,
tasks, reset_date, create_todays_tasks) stays in Postgres. It is untouchable
without a deliberate, separate operator decision. The board model moves to
Nostr. The two coexist in the same database during transition (the habit
tables are unaffected by changes to board tables).

### Phase 1: Public boards on Nostr (no encryption)

**Precondition:** Relay write whitelist widened for board users, OR an
alternative relay is used.

1. Add Nostr event publishing to board write operations (dual-write:
   Postgres AND relay)
2. Backend subscribes to relay events and keeps Postgres projection in sync
3. Frontend reads from Postgres projection (unchanged API)
4. Verify: projection matches direct relay queries for all board data
5. Remove Postgres writes for boards (relay is now the record)
6. Postgres board tables become projection-only (can be rebuilt from relay)

During dual-write, Postgres is still authoritative. The relay is a copy.
This is safe to revert at any point by stopping the event publishing.

### Phase 2: Private boards on Nostr (requires signer grants)

**Precondition:** Decision d41b70c3 resolved (signer custody for blanket
nip44_decrypt grants).

1. Integrate signer grant request into board UI (see Inherited findings)
2. Encrypt card content for board members on publish
3. Server-side or client-side decryption for the projection (see Query above)
4. Handle grant lapse mid-session
5. Remove Postgres storage for private boards

### Existing data migration

Live boards on production (including board 98, the fleet board) need to be
exported as Nostr events and published to the relay. The migration script:

1. Read each board from Postgres
2. Build kind 30301 event (board metadata, columns, tags, members)
3. Build kind 30302 events (card content) and kind 30303 events (card state)
4. Build kind 1111 events (comments)
5. Sign all events with the board owner's key (fleet key for fleet boards,
   operator's key for operator boards)
6. Publish to relay
7. Verify the projection matches the original Postgres data

The operator's boards require their signer to sign the migration events.
This is a one-time operation.

---

## 7. Fleet writes

The bridge currently writes via HTTP API with its own pubkey. Under the
Nostr model, it signs events with the fleet key. This is cleaner: each event
has a cryptographically verifiable author.

The bridge holds its own key (generated by `fleet_tasks.py newkey`, mode
0600). It has no connection to coldforge-signer. It owns its boards and
shares them with the operator. This shape does not change.

**What changes for the bridge (coord task f7805d36):**
- Writes become `sign event + publish to relay` instead of `HTTP POST to API`
- Idempotency uses NIP-33 replaceable semantics (same kind + d-tag = replacement)
  instead of PostgreSQL's `ON CONFLICT` on the external index
- The deterministic d-tag for bridged cards is `coord:<task-uuid>`
- Comment events are regular (kind 1111), so dedup uses the external tag
  convention rather than replaceable semantics
- The `author_label` column (session role tag for provenance) becomes a tag
  on the comment event

**What does NOT change:**
- The bridge signs with its own key (no signer grants)
- The bridge owns the fleet board (no transfer)
- The bridge has no access to the operator's key
- A read-only display name for the bridge ("Fleet") comes from a profile
  event (kind 0) published by the fleet key, which any Nostr client can
  resolve

---

## Encryption model (private boards)

Unchanged from the original design. Summary:

Private boards use NIP-44 v2 encryption. Content fields (title, description,
comment body) are encrypted per-member. Structural tags (d-tag, column, sort
key) stay public for relay-side filtering.

### Metadata leakage

"Private" seals the prose but publishes the work state machine: how many
cards, which column each sits in, who is assigned, when cards moved. For the
fleet board specifically, the deterministic d-tag `coord:<task-uuid>`
publishes the coord task UUID in the clear.

No clean fix exists. The operator should make this trade knowingly.

### Signer grant lifecycle

Reading a private board requires an active `nip44_decrypt` grant. Writing
requires `sign_event`. See the Inherited findings in the original design for
the three measured constraints (wildcard grants are silent, client session has
no expiry awareness, SQLite storage has no expiry enforcement).

### THIS IS d41b70c3 AGAIN

Private tasks as Nostr events must be encrypted. Encrypted means a signer
must decrypt them, routinely, in a browser, for every board the user opens.
The operator has also asked for public boards, which are the easy half.

This design does NOT assume the custody question is settled. Public boards
ship first (Phase 1). Private boards are gated on d41b70c3.

---

## Addressing the original objections

The CLAUDE.md lists three costs of Nostr-native storage. Each one is real.

### "Lose query capabilities"

**True for encrypted events, not for public ones.** For public boards,
relay-side filtering handles structured queries (by board, column, author,
assignee). Complex queries (full-text search, multi-field filters) run
against the Postgres projection, which is derived from events and
rebuildable. The same queries work; the data flows through a relay first.

For private boards, the relay cannot filter encrypted content. Queries must
happen client-side (after decryption) or against a server-side projection
(which requires custody). This cost is real and is the reason private boards
are Phase 2.

### "Add complexity without proportional benefit"

**The complexity is real.** Event aggregation (multiple events per card),
concurrent-edit resolution (last-write-wins on state events, fractional
indexing for ordering), the projection layer, and encryption for private
boards are all genuinely harder than SQL.

**The benefit changed.** The operator stated it: data portability. A user can
export their boards by subscribing to their events. Any Nostr client can read
a public board. The user's data is not locked in a single app's database.
That is the product's thesis applied to its own task data, and the operator
has decided the complexity is worth paying.

### "Use relays as dumb blob storage"

**True for encrypted private boards.** The relay stores opaque blobs and can
only filter by structural tags (d-tag, kind, pubkey).

**Not true for public boards.** The relay stores structured events with
meaningful tags. It can filter, deliver subscriptions, and enable
interoperability with other Nostr clients. This is relay storage working as
designed.

The split model (public boards = Nostr-native in Phase 1, private boards =
Phase 2 after d41b70c3) minimizes the "dumb blob" case to the scenario
where encryption is genuinely necessary.

---

## Sequencing recommendation

I agree with the task's suggested order: finish board features in Postgres
first, then move the record underneath.

1. **Now:** This design document, for the operator to review and rule on.
2. **Continue:** Board feature development in Postgres (the event model is
   designed to match the Postgres schema's shape, so features built now will
   map cleanly onto events later).
3. **When features stabilize:** Implement Phase 1 (public boards on Nostr,
   dual-write, projection).
4. **When d41b70c3 resolves:** Implement Phase 2 (private boards on Nostr,
   encrypted events, signer grants).

Building the Nostr layer before the feature set is settled means designing
an event model for a product that is still moving. The current feature
velocity (6 items shipped in one session: tags, checklists, filters,
markdown, expandable comments, drag-and-drop) argues for finishing first.

---

## Open questions for the operator

1. **Relay write policy.** Phase 1 is unreachable for non-whitelisted users.
   Widen the whitelist, or accept that only whitelisted keys can create
   boards on the hosted relay?

2. **Private board metadata trade.** Is publishing task count, column
   distribution, movement timestamps, and assignee pubkeys on a world-
   readable relay acceptable for "private" boards? No technical fix exists.

3. **Transfer ownership protocol.** The Nostr model makes ownership transfer
   a two-step key-coordination exercise. Is this acceptable, or should
   transfer be dropped from the Nostr-native model?

4. **Event kind registration.** 30301/30302/30303 are application-specific
   placeholders. Register them as a NIP if boards should be a protocol
   (interoperable with other clients), or keep them internal if boards are
   just a feature.
