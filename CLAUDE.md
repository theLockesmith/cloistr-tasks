# CLAUDE.md - ritual-forge

**Personal task management application with Nostr authentication**

**Status:** Reviving - migrating from Keycloak to Nostr auth

## Documentation

Coldforge strategy: `~/claude/coldforge/strategy/CLAUDE.md`
Coldforge overview: `~/claude/coldforge/CLAUDE.md`
Roadmap entry: `~/claude/coldforge/strategy/roadmap.md` (Phase 3: Productivity)

## Project Overview

ritual-forge is a personal task management tool. It uses Nostr for **authentication only** - task data is stored traditionally (not as Nostr events).

### Why Not Nostr-Native Storage?

Tasks are inherently private. Storing them as encrypted Nostr events would:
- Lose query capabilities (relays can't filter encrypted content)
- Add complexity without proportional benefit
- Use relays as dumb blob storage

See README.md "Non-Goals" section for full rationale.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React (TypeScript) |
| Backend | Go (planned migration from current) |
| Auth | Nostr (NIP-07, NIP-46, NIP-55) |
| Storage | Traditional (SQLite/PostgreSQL) |

## Roadmap

### Phase 1: Nostr Authentication (Current Priority)

Replace Keycloak OAuth with Nostr-native authentication:

- [ ] **NIP-07** - Browser extension signing (nos2x, Alby)
- [ ] **NIP-46** - Remote signing (nsecbunker)
- [ ] **NIP-55** - Android signer intents (Amber)
- [ ] NIP-19 - Bech32 identifier encoding (npub display)
- [ ] Remove Keycloak dependency

### Phase 2: Core Features

- [ ] Task completion tracking
- [ ] Due date management
- [ ] Task priority levels
- [ ] Drag-and-drop reordering

### Phase 3: Enhanced Features

- [ ] Calendar integration
- [ ] Notification system
- [ ] Data export/import

### Future Consideration

Potential Cloistr integration - shared identity with other Coldforge services, possible service offering.

## Development

```bash
# Frontend
cd frontend && npm install && npm start

# Backend
cd backend && go run .
```

## Non-Goals

- **Nostr event storage** - Tasks stay in traditional storage
- **Hybrid publishing** - No "post task to relay" features
- **Custodial key storage** - App never touches nsec

---

**Last Updated:** 2026-02-12
