# Design: Nostr-Native Boards

**Status:** DEFERRED. Operator ruled on 2026-09-14 that boards remain on PostgreSQL for now. This document stands as the plan for whenever Nostr-native boards are picked back up. It is not a current roadmap item.
**Date:** 2026-09-12
**Author:** cloistr-tasks session

## Summary

Move board data (columns, cards, comments) off PostgreSQL onto Nostr events.
Personal tasks and habits stay in PostgreSQL, unchanged.

This is a scope expansion of the board model shipped in migrations 011-014.
It replaces the PostgreSQL storage layer for boards with signed Nostr events
stored on relays, making boards portable across any Nostr client and
removing the server as a single point of truth.

The cost: the signer becomes a runtime dependency for boards, not just a
login-time one. Every board write needs a signed event. Every private board
read needs an active `nip44_decrypt` grant. The signer was previously fire-
and-forget after the auth challenge; it is now load-bearing for the entire
board session.

## What moves, what stays

| Data            | Today           | After                      |
|-----------------|-----------------|----------------------------|
| Personal tasks  | PostgreSQL      | PostgreSQL (no change)     |
| Habits/routines | PostgreSQL      | PostgreSQL (no change)     |
| User settings   | PostgreSQL      | PostgreSQL (no change)     |
| Board structure  | PostgreSQL     | Nostr events               |
| Board cards     | PostgreSQL      | Nostr events               |
| Card comments   | PostgreSQL      | Nostr events (NIP-22)      |
| Board access    | task_list_shares| Nostr event tags + grants  |
| Labels          | PostgreSQL      | PostgreSQL (no change)     |

The argument in README.md "Non-Goals" still holds for personal tasks: they
are inherently private, query-heavy, and gain nothing from relay storage.
Boards are different. They are collaborative, can be public, and portability
across Nostr clients is the whole point of the Cloistr vision.

## Event model

All board events use parameterized replaceable kinds (NIP-33, kind 30000-
39999 range) so updates replace previous versions atomically.

### Board definition: kind 30301

A single replaceable event per board. The `d` tag is the board's stable
identifier. Columns are embedded as ordered tags because boards rarely have
more than 3-10 columns, and embedding them makes column reorder atomic with
the board update.

```json
{
  "kind": 30301,
  "tags": [
    ["d", "<board-uuid>"],
    ["title", "Sprint Board"],
    ["description", "Current sprint work"],
    ["visibility", "public"],
    ["col", "<col-uuid>", "To Do", "#3b82f6", "0"],
    ["col", "<col-uuid>", "In Progress", "#f59e0b", "1"],
    ["col", "<col-uuid>", "Done", "#22c55e", "2"],
    ["member", "<pubkey-hex>", "write"],
    ["member", "<pubkey-hex>", "read"]
  ],
  "content": ""
}
```

For private boards, `content` holds NIP-44 encrypted metadata and the
`visibility` tag reads `"private"`. See the Encryption section.

Column tags carry: uuid, display name, color (hex), sort order. Adding,
removing, or reordering columns means publishing a new version of the board
event.

Member tags carry the pubkey and permission level (`read`, `write`). This
replaces the `task_list_shares` table. The board owner is the event author.

### Board card: kind 30302

One replaceable event per card. The `d` tag is the card's stable identifier.

```json
{
  "kind": 30302,
  "tags": [
    ["d", "<card-uuid>"],
    ["a", "30301:<board-author-pubkey>:<board-uuid>"],
    ["col", "<col-uuid>"],
    ["title", "Fix login timeout"],
    ["priority", "3"],
    ["due", "2026-09-15"],
    ["assignee", "<pubkey-hex>"],
    ["sort", "5"],
    ["external", "coord", "<coord-task-uuid>"]
  ],
  "content": "Card description as markdown"
}
```

The `a` tag (NIP-33 address reference) ties the card to its board. The `col`
tag places it in a column. Moving a card between columns means publishing a
new version with a different `col` tag.

For private boards, `title` moves into encrypted `content` and the public
tag set shrinks to `d`, `a`, `col`, `sort` (enough for relay-side
filtering without leaking card content).

### Card comment: kind 1111 (NIP-22)

Standard comment events referencing the card.

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

NIP-22 comments use uppercase tag letters (`K`, `E`, `A`) to reference the
root content being commented on, following the standard. The optional
`parent` tag enables threading (replacing the `parent_comment_id` column).

Comments are regular events, not replaceable. Deletion uses NIP-09 (kind 5
deletion request). Tombstoning (clearing body, keeping thread structure) maps
to publishing a replacement with empty content and a `deleted` tag.

## Encryption model (private boards)

Private boards use NIP-44 v2 encryption. The board owner encrypts content
for each member individually. This creates O(members) sealed copies per
event, which is acceptable for boards (typically 2-20 members, not hundreds).

### What is encrypted vs. what stays public

| Field              | Public board | Private board          |
|--------------------|-------------|------------------------|
| Event kind         | Public      | Public                 |
| `d` tag (uuid)     | Public      | Public                 |
| `a` tag (board ref)| Public      | Public                 |
| `col` tag          | Public      | Public                 |
| `sort` tag         | Public      | Public                 |
| `title` tag        | Public      | Encrypted (in content) |
| `description`      | Public      | Encrypted (in content) |
| `content`          | Public      | Encrypted              |
| `member` tags      | Public      | Public (pubkeys only)  |
| `assignee` tag     | Public      | Public (pubkey only)   |

The encrypted content payload is a JSON object:

```json
{
  "title": "Fix login timeout",
  "description": "Card description as markdown",
  "meta": {}
}
```

This means a relay can still filter private board cards by board, column,
and sort order, but cannot see what the cards say. Member pubkeys are visible
(the relay knows who participates) but the work content is sealed.

### Metadata leakage on private boards

"Private" in this model seals the prose but publishes the work state
machine. The public tags on a private board, taken together, reveal:

- **How many cards exist** (count of kind 30302 events with the board's
  `a` tag)
- **Which column each card sits in** (`col` tag), and when it moved
  (event `created_at` on each replacement)
- **Which pubkey is assigned** (`assignee` tag)
- **When each card was created, updated, or finished**

For the fleet bridge specifically, the deterministic `d` tag
`coord:<task-uuid>` publishes the coord task UUID in the clear,
permanently, on a world-readable relay. The UUID is opaque and carries no
user content, but it cross-references the coord system and allows
enumeration of the fleet's entire task set.

This is a different trade from the one the word "private" implies. It may
be acceptable, but the operator should make it knowingly. The standing
position is that the fleet's own size and tempo are not published to a
world-readable relay without explicit authorization; the presence roster
is OFF today for exactly that reason.

**No clean fix exists.** Sealing the `d` tag is ruled out by migration 014
(NIP-44 non-determinism breaks replaceable-event dedup). A keyed digest
(HMAC of the coord UUID under a board secret) would keep replacement
semantics while removing the cross-reference to coord, but it does nothing
about `col`, `sort`, `assignee`, or the count. State the trade; do not
engineer around it.

### Signer grant lifecycle

Reading a private board requires an active `nip44_decrypt` grant from
coldforge-signer. Writing requires `sign_event`. A read-only board viewer
needs only decrypt, not signing.

The grant shape that ships today:

```
POST /api/v1/requests/{request_id}/approve
{"methods": ["nip44_decrypt"], "remember": true, "expires_at": "<RFC3339>"}
```

Method scope is enforced in the signer (`isMethodAllowed`). Expiry is
enforced in the PostgreSQL storage layer (production path).

**UI implications:**

1. **On board open**, if no active grant exists, prompt the user to approve
   a scoped grant. Default to `nip44_decrypt` only for viewers,
   `nip44_decrypt` + `sign_event` for writers.

2. **Grant lapse mid-session.** The client session type has no expiry field
   and nothing compares it to the current time. A browser holding a scoped
   grant will not notice it lapsing; it will just start getting refusals
   from the signer. The board UI must handle this: catch decrypt/sign
   failures, surface a re-authorization prompt, and avoid losing unsaved
   card edits. A countdown or "grant expires in X" indicator is worth
   building but not required for launch.

3. **Default grant duration.** Suggest 8 hours for interactive sessions.
   The fleet bridge (coord mirror) should use shorter grants, scoped per
   sync run.

## Inherited findings

These are from the signer grant audit (d41b70c3, completed 2026-09-06) and
the follow-up probe by conscience-cloistr-ops (2026-09-07). They are stated
as inherited measurements, not this session's own verification. Nobody has
yet minted a scoped expiring grant and driven a real decrypt through it end
to end. What is measured is that the mint path accepts those fields and both
enforcement points are in the deployed source.

1. **Wildcard grants are silent.** Both `["*"]` and `["all"]` are treated as
   method wildcards by the signer. A carelessly minted grant is blanket with
   no warning. The board UI must always enumerate methods explicitly
   (`["nip44_decrypt"]` or `["nip44_decrypt", "sign_event"]`), never pass a
   wildcard. A lint or assertion in the grant request code is warranted.

2. **Client session has no expiry awareness.** The signer's client session
   type has no `expires_at` field and no comparison against current time.
   The browser will not know a grant has lapsed until it tries to use it and
   gets refused. Design the board's error handling for this: catch the
   refusal, show a re-auth prompt, preserve any in-progress card edits in
   local state while the user re-authorizes.

3. **SQLite storage path has no expiry enforcement.** The PostgreSQL storage
   backend (production path) checks expiry. The SQLite backend does not.
   This is not the production path today, but it is a trapdoor: if the
   storage backend ever changes, grants that should have expired will not.
   This is documented here so it is not rediscovered later as a bug.

## Access control translation

Current PostgreSQL model:

| Concept       | PostgreSQL                                    |
|---------------|-----------------------------------------------|
| Ownership     | `task_lists.user_id = pubkey`                 |
| Share grant   | `task_list_shares(list_id, pubkey, permission)`|
| Check         | `listAccess()` in `lib/access.js`             |

Nostr-native model:

| Concept       | Nostr                                          |
|---------------|------------------------------------------------|
| Ownership     | Event author pubkey                            |
| Share grant   | `member` tags on the board event               |
| Check         | Client-side: am I the author or in a member tag?|

For public boards, any client can read the events from any relay. For
private boards, a client needs the decrypt grant, so access is enforced
cryptographically rather than by server-side row checks.

### Write whitelist (PRECONDITION for Phase 1)

The hosted relay (`wss://relay.cloistr.xyz`) does NOT accept any signed
event. It enforces a write whitelist: only pubkeys listed in
`WRITE_WHITELIST_PUBKEYS` (ConfigMap `cloistr-relay-config`, namespace
`cloistr`) may publish events. As of 2026-09-12, five pubkeys are
whitelisted. A non-whitelisted key gets:

    restricted: your pubkey is not on the whitelist

Measured on production by cloistr-ops (`client_probe.py`, 2026-09-12)
with a control publish from the fleet key succeeding in the same run.
Source: `cloistr-config` origin/main, `base/relay/configmap-relay.yaml:34`,
deployed revision c47dcaa, app Synced and Healthy with automated selfHeal.

This means under the Nostr-native model, a user who is not one of those
five keys cannot create a board, add a card, or post a comment on the
hosted relay. Phase 1 ("public boards, no encryption") is unreachable for
any user not on the whitelist unless the write policy is widened.

**This design does not decide the policy change.** Widening relay write
policy is a security-posture decision belonging to cloistr-orchestrator
and the operator. It is named here as a precondition so Phase 1 is not
built and then discovered to be unreachable. A related decision request
(coord `6688f453`) is open from the threads side, making this the second
consumer blocked behind the same write-policy question.

Write access for authorized pubkeys is enforced by the relay's write
whitelist today. The board owner's client should additionally filter
displayed cards to only those from `member`-tagged pubkeys, as a defense
against a whitelisted key publishing unauthorized cards.

## Fleet bridge (coord mirror)

The current board model has `external_id` and `external_source` columns for
bridging coord tasks onto board cards. In the Nostr-native model, the
`external` tag on card events serves the same purpose. The bridge writes
signed events instead of HTTP API calls.

The bridge holds its OWN account key (generated by `fleet_tasks.py newkey`,
mode 0600), and signs locally. It has no connection to coldforge-signer: no
token, no grant, no access to the operator's identity. It OWNS its board
and SHARES it with the operator at `write`. This shape was adopted on
2026-09-09 when list sharing deployed: identical capability, strictly less
authority, revocation is a DELETE the operator performs from their own app.

Under the Nostr-native model nothing about that has to change. The fleet
key signs its own board and card events. It is already on the relay's write
whitelist (3331f3b0..., added 2026-09-06 under coord 450a4639). For a
private board the fleet is the AUTHOR, so it encrypts to each member with
its own key by ECDH, locally. Zero signer involvement in either direction.

**The bridge must NOT be given a signer grant.** Doing so would re-couple
fleet operation to the operator's key custody, which is precisely what the
sharing model was adopted to avoid, and it would add a runtime dependency
on a service the mirror does not touch today.

Idempotency changes: instead of PostgreSQL's `ON CONFLICT` on the external
index, the bridge publishes replaceable events with a deterministic `d` tag
derived from the external source and ID (e.g., `coord:<task-uuid>`). NIP-33
replaceable event semantics handle dedup: same author + same kind + same `d`
tag = replacement, not duplicate.

## Migration path

### Phase 1: Public boards on Nostr (no encryption needed)

**Precondition:** The relay write whitelist must be widened to admit board
users, or an alternative write path must exist. Without this, Phase 1 is
unreachable for everyone except five whitelisted pubkeys. This is a
security-posture decision, not a code change. See Access Control above.

1. Add event publishing to write operations (create board, add card, etc.)
2. Backend publishes Nostr events alongside PostgreSQL writes (dual-write)
3. Frontend reads from relay, falls back to API
4. Once stable, remove PostgreSQL reads for boards
5. Remove PostgreSQL writes for boards (API becomes relay-only)

### Phase 2: Private boards on Nostr (requires grant integration)

1. Integrate signer grant request flow into board UI
2. Encrypt board content for members on publish
3. Decrypt on read using active grant
4. Handle grant lapse (finding #2)
5. Remove PostgreSQL storage for private boards

### Fallback

"Ship public boards first, private later" remains available. Public boards
need no encryption, no grants, and no signer coupling beyond event signing
(which the auth flow already proves works). This is the lower-risk path and
can ship independently.

## What this does NOT cover

- **Personal tasks/habits**: stay in PostgreSQL, per README.md rationale
- **Labels**: stay in PostgreSQL (dedup constraint, NIP-44 non-determinism;
  see migration 014 and CLAUDE.md "Known Constraints")
- **User settings**: stay in PostgreSQL
- **NIP-55 (Android signer)**: future work, not blocking
- **Relay selection/NIP-65**: separate task (6037876c)
- **End-to-end verification of scoped grants**: nobody has driven a real
  scoped decrypt through the full path yet. This design assumes the mint
  and enforcement work as the source reads, but that must be verified before
  Phase 2 implementation begins.

## Open questions

1. **Event kind numbers.** 30301/30302 are placeholders. Should we register
   these with the NIP process, or use the unregistered application-specific
   range? Cloistr's relay can accept any kind; interop with other clients
   matters only if we want boards to be a protocol, not just a feature.

2. **Column-in-board vs. column-as-event.** This design embeds columns as
   tags in the board event. The tradeoff: column reorder is atomic but
   every column change republishes the entire board event. For boards with
   many members getting notifications, this may be noisy. An alternative is
   separate column events (kind 30303 or similar), but then column ordering
   requires reading multiple events and reconciling.

3. ~~**Relay write policy for private boards.**~~ ANSWERED by production
   measurement: the relay already enforces a write whitelist. The question
   is not whether to add write restrictions but whether to WIDEN them for
   board users. That decision is with cloistr-orchestrator and the operator
   (coord `6688f453` and the precondition noted in Access Control above).

4. **Private board metadata trade.** The operator must decide whether
   publishing task count, column distribution, movement timestamps, and
   assignee pubkeys on a world-readable relay is acceptable for "private"
   boards. See Metadata leakage section. No clean technical fix exists.
