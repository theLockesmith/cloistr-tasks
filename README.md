# Ritual Forge

A personal task management application with Nostr authentication for daily routines and habit tracking.

## Features

### Authentication
- **Nostr NIP-07**: Sign in with browser extensions (Alby, nos2x, etc.)
- **Nostr NIP-46**: Remote signing via bunker (coming soon)
- **No passwords**: Your Nostr identity is your login
- **JWT sessions**: Secure token-based sessions with automatic refresh

### Task Management
- **Custom Task Lists**: Create personalized lists with icons and colors
- **Task Templates**: Define reusable daily tasks
- **Daily Reset**: Tasks reset on your schedule
- **Visual Customization**: Emoji icons and color themes per list

### User Experience
- **Clean Interface**: Modal-based forms for creating lists and tasks
- **Keyboard Shortcuts**: ESC key support
- **Loading States**: Visual feedback during operations
- **npub Display**: Human-readable Nostr identifiers

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React (JavaScript) |
| Backend | Node.js / Express |
| Auth | Nostr (NIP-07, NIP-19) |
| Database | PostgreSQL |
| Sessions | JWT |

## Setup and Installation

### Prerequisites
- Node.js (v18 or higher)
- PostgreSQL database
- A NIP-07 compatible browser extension (Alby, nos2x, etc.)

### Environment Variables

Backend `.env`:
```bash
PORT=3000
DATABASE_URL=postgresql://user:password@localhost/ritual_forge
JWT_SECRET=your-secure-secret-change-in-production
JWT_EXPIRES_IN=24h
```

Frontend `.env`:
```bash
REACT_APP_API_URL=http://localhost:3000/api
```

### Installation

```bash
# Frontend
cd frontend && npm install && npm start

# Backend
cd backend && npm install && npm start
```

## API Endpoints

### Authentication
- `GET /api/auth/config` - Auth configuration (supported NIPs)
- `GET /api/auth/challenge` - Get authentication challenge
- `POST /api/auth/verify` - Verify signed event, get JWT
- `POST /api/auth/refresh` - Refresh JWT token
- `GET /api/auth/token-info` - Validate token and get user info

### User
- `GET /api/user/profile` - Get user profile and settings
- `PUT /api/user/settings` - Update user settings
- `POST /api/user/reset` - Manual task reset for today
- `GET /api/user/analytics` - Task completion analytics
- `GET /api/user/reset-history` - Reset history

### Lists and Tasks
- `GET /api/lists` - Get all task lists
- `POST /api/lists` - Create new task list
- `GET /api/lists/:listId/tasks` - Get tasks for a list
- `POST /api/lists/:listId/templates` - Add task template
- `PUT /api/templates/:templateId` - Update template
- `DELETE /api/templates/:templateId` - Delete template
- `POST /api/tasks/:taskId/toggle` - Toggle task completion

## Authentication Flow

1. Frontend requests challenge from `/api/auth/challenge`
2. User signs challenge with NIP-07 extension
3. Frontend sends signed event to `/api/auth/verify`
4. Backend verifies Nostr signature and issues JWT
5. JWT used for subsequent API calls
6. Automatic token refresh before expiry

## Non-Goals

- **Nostr event storage**: Tasks remain in traditional PostgreSQL storage, not published as Nostr events
- **Hybrid publishing**: No "post task to relay" features
- **Custodial key storage**: App never touches nsec; external signers handle keys

## Roadmap

### Phase 1: Nostr Authentication (Current)

- [x] **NIP-07** - Browser extension signing (nos2x, Alby, etc.)
- [x] **NIP-19** - Bech32 identifier encoding (npub display)
- [x] **Remove Keycloak** - Fully migrated to Nostr auth
- [ ] **NIP-46** - Remote signing (nsecbunker) - UI ready, implementation pending
- [ ] **NIP-55** - Android signer intents (future, if native app)

### Phase 2: Core Features

- [x] Task completion tracking
- [ ] Due date management
- [ ] Task priority levels
- [ ] Drag-and-drop reordering
- [ ] Advanced filtering and search

### Phase 3: Enhanced Features

- [ ] Calendar integration
- [ ] Notification system
- [ ] Data export/import
- [ ] Backend migration to Go

### Future Consideration

- Cloistr integration for shared identity across Coldforge services

## Development

```bash
# Run both frontend and backend
cd frontend && npm start &
cd backend && npm start
```

## License

MIT

---

Built with Nostr authentication - your keys, your identity.
