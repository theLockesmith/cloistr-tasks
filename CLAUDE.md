# CLAUDE.md - Ritual Forge

**Personal task management application with Nostr authentication**

**Status:** Active development - Nostr auth implemented, expanding features

## REQUIRED READING (Before ANY Action)

**Claude MUST read this file at the start of every session:**
- `~/claude/coldforge/cloistr/CLAUDE.md` - Cloistr project rules (contains further required reading)

## Project Overview

Ritual Forge is a personal task management tool for daily routines and habits. It uses Nostr for **authentication only** - task data is stored traditionally in PostgreSQL.

### Why Not Nostr-Native Storage?

Tasks are inherently private. Storing them as encrypted Nostr events would:
- Lose query capabilities (relays can't filter encrypted content)
- Add complexity without proportional benefit
- Use relays as dumb blob storage

See README.md "Non-Goals" section for full rationale.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React (JavaScript) |
| Backend | Node.js / Express |
| Auth | Nostr (NIP-07, NIP-19, NIP-46) |
| Database | PostgreSQL |
| Sessions | JWT |

## Roadmap

### Phase 1: Nostr Authentication (Complete)

- [x] **NIP-07** - Browser extension signing (nos2x, Alby)
- [x] **NIP-19** - Bech32 identifier encoding (npub display)
- [x] **Remove Keycloak** - Fully migrated to Nostr auth
- [x] **NIP-46** - Remote signing (nsecbunker)
- [ ] **NIP-55** - Android signer intents (Amber) - future, if native app

### Phase 2: Core Features

- [x] Task completion tracking
- [ ] Due date management
- [ ] Task priority levels
- [ ] Drag-and-drop reordering

### Phase 3: Enhanced Features

- [ ] **iCal feed export** - Expose tasks with due dates as `.ics` feed (loose coupling for calendar integration)
- [ ] Notification system
- [ ] Data export/import
- [ ] Backend migration to Go

### Design Decisions

- **Loose coupling over integration** - Apps communicate via standard protocols (iCal, CalDAV) rather than direct integration. Self-hosters can deploy apps independently.

## Development

```bash
# Frontend
cd frontend && npm install && npm start

# Backend
cd backend && npm install && npm start
```

## Key Files

### Authentication
- `frontend/src/lib/nostr.js` - Nostr utilities (NIP-07, NIP-19, NIP-46)
- `frontend/src/components/AuthContext.js` - React auth context
- `frontend/src/components/LoginScreen.js` - Login UI
- `backend/middleware/auth.js` - JWT middleware
- `backend/server.js` - Auth endpoints (`/api/auth/*`)

### Database
- `backend/database/init.js` - Schema and initialization

## Non-Goals

- **Nostr event storage** - Tasks stay in PostgreSQL
- **Hybrid publishing** - No "post task to relay" features
- **Custodial key storage** - App never touches nsec

---

**Last Updated:** 2026-03-06
