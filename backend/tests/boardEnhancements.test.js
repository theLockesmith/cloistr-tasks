/**
 * Structural tests for board enhancement features (server.js):
 *   - Board-level comments (GET/POST /api/boards/:listId/comments)
 *   - Card comment threading (parent_comment_id, list_id columns)
 *   - Public board endpoint (GET /api/public/boards/:listId)
 *   - Visibility update (PUT /api/lists/:listId)
 *
 * WHY SOURCE-LEVEL:
 * These features involve precise SQL shape (which columns are NULL, which fields
 * are SELECTed, which middleware is wired) that would be difficult to catch
 * through integration tests without a live database.  Source-level assertions
 * verify the structural contracts — correct column lists, correct NULL placement,
 * correct middleware, correct visibility guard — immediately, without
 * infrastructure.
 */

import { describe, test, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the async handler body for `app.<method>('<routePath>', authenticateToken, ...)`.
 * Returns null if the route is not registered or does not wire authenticateToken.
 */
function extractRouteBody(source, method, routePath) {
  const escapedPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(
    `app\\.${method}\\(['"]${escapedPath}['"],\\s*authenticateToken`
  );
  const match = source.match(startPattern);
  if (!match) return null;

  let i = match.index + match[0].length;
  while (i < source.length && source[i] !== '{') i++;
  if (i >= source.length) return null;

  let depth = 0;
  const start = i;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

/**
 * Variant of extractRouteBody that accepts an explicit middleware name.
 * Used for routes wired with a middleware other than authenticateToken
 * (e.g. optionalAuth for public endpoints).
 */
function extractRouteBodyWithMiddleware(source, method, routePath, middleware) {
  const escapedPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(
    `app\\.${method}\\(['"]${escapedPath}['"],\\s*${middleware}`
  );
  const match = source.match(startPattern);
  if (!match) return null;

  let i = match.index + match[0].length;
  while (i < source.length && source[i] !== '{') i++;
  if (i >= source.length) return null;

  let depth = 0;
  const start = i;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return null;
}

// ── 1. Board-level comment route registration ─────────────────────────────

describe('board-level comment routes are registered with authenticateToken', () => {
  test('GET /api/boards/:listId/comments is registered', () => {
    expect(extractRouteBody(serverSrc, 'get', '/api/boards/:listId/comments')).not.toBeNull();
  });

  test('POST /api/boards/:listId/comments is registered', () => {
    expect(extractRouteBody(serverSrc, 'post', '/api/boards/:listId/comments')).not.toBeNull();
  });
});

// ── 2. Board-level comment GET — SQL shape ────────────────────────────────

describe('GET /api/boards/:listId/comments — board-level comment SELECT', () => {
  const body = extractRouteBody(serverSrc, 'get', '/api/boards/:listId/comments');

  test('filters to card_id IS NULL (excludes card-attached comments)', () => {
    expect(body).toContain('card_id IS NULL');
  });

  test('returns parent_comment_id in SELECT column list', () => {
    // Threading requires the client to receive parent_comment_id so it can
    // reconstruct the thread tree.
    expect(body).toContain('parent_comment_id');
  });

  test('queries card_comments table', () => {
    expect(body).toContain('card_comments');
  });

  test('filters by list_id (not by card_id)', () => {
    // Board-level comments have no card: the WHERE clause must use list_id.
    expect(body).toContain('list_id');
  });
});

// ── 3. Board-level comment POST — INSERT shape ────────────────────────────

describe('POST /api/boards/:listId/comments — board-level comment INSERT', () => {
  const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/comments');

  test('INSERT column list includes card_id', () => {
    // card_id must be present so it can be explicitly set to NULL.
    expect(body).toContain('card_id');
  });

  test('INSERT VALUES sets card_id to NULL explicitly', () => {
    // Board-level comments have no card.  The VALUES clause must pass NULL
    // for card_id rather than omitting the column (which would rely on a
    // DEFAULT that may not exist).
    expect(body).toContain('VALUES ($1, NULL,');
  });

  test('INSERT column list includes parent_comment_id', () => {
    // Threaded board comments require parent_comment_id to be persisted.
    expect(body).toContain('parent_comment_id');
  });

  test('destructures parentCommentId from req.body', () => {
    // The handler must read parentCommentId so it can be forwarded to the
    // INSERT; without this, all board-level replies become top-level comments.
    expect(body).toContain('parentCommentId');
  });

  test('requires write access to post a board comment', () => {
    expect(body).toContain("hasAccess(access, 'write')");
  });
});

// ── 4. Card comment GET — threading and list_id in SELECT ─────────────────

describe('GET /api/boards/:listId/cards/:cardId/comments — card comment SELECT', () => {
  const body = extractRouteBody(serverSrc, 'get', '/api/boards/:listId/cards/:cardId/comments');

  test('returns parent_comment_id in SELECT column list', () => {
    expect(body).toContain('parent_comment_id');
  });

  test('returns list_id in SELECT column list', () => {
    // list_id is included so the client can navigate back to the board without
    // a separate lookup.
    expect(body).toContain('list_id');
  });

  test('queries card_comments table', () => {
    expect(body).toContain('card_comments');
  });
});

// ── 5. Card comment POST — threading and list_id in INSERT ────────────────

describe('POST /api/boards/:listId/cards/:cardId/comments — card comment INSERT', () => {
  const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/comments');

  test('INSERT column list includes parent_comment_id', () => {
    // Reply threading: parent_comment_id must be saved at INSERT time.
    expect(body).toContain('parent_comment_id');
  });

  test('INSERT column list includes list_id', () => {
    // list_id on the comment row enables efficient board-level queries without
    // joining through board_cards.
    expect(body).toContain('list_id');
  });

  test('resolves list_id via subquery on board_cards', () => {
    // The INSERT must not require the caller to supply list_id — it derives it
    // from the card row to prevent list_id spoofing.
    expect(body).toContain('SELECT list_id FROM board_cards WHERE id');
  });

  test('reads parentCommentId from req.body', () => {
    expect(body).toContain('parentCommentId');
  });
});

// ── 6. Public board endpoint — route registration and middleware ───────────

describe('GET /api/public/boards/:listId — public board endpoint', () => {
  test('GET /api/public/boards/:listId endpoint exists', () => {
    // The route must appear somewhere in the source.
    expect(serverSrc).toContain("'/api/public/boards/:listId'");
  });

  test('uses optionalAuth middleware (not authenticateToken)', () => {
    // Public routes must not require a JWT — optionalAuth passes req.user
    // through when a token is present but does not block unauthenticated
    // callers.
    const body = extractRouteBodyWithMiddleware(
      serverSrc, 'get', '/api/public/boards/:listId', 'optionalAuth'
    );
    expect(body).not.toBeNull();
  });

  test('is NOT wired with authenticateToken', () => {
    // Wiring authenticateToken here would block anonymous access to public
    // boards — verify it is absent from the route registration line.
    const bodyWithAuth = extractRouteBody(
      serverSrc, 'get', '/api/public/boards/:listId'
    );
    expect(bodyWithAuth).toBeNull();
  });

  test("checks visibility = 'public' for unauthenticated access", () => {
    const body = extractRouteBodyWithMiddleware(
      serverSrc, 'get', '/api/public/boards/:listId', 'optionalAuth'
    );
    expect(body).toContain("visibility = 'public'");
  });

  test('filters out cards with external_source for public view', () => {
    // Cards imported via external_source may be subject to usage terms that
    // do not extend to anonymous readers; they must be omitted from the
    // unauthenticated response.
    const body = extractRouteBodyWithMiddleware(
      serverSrc, 'get', '/api/public/boards/:listId', 'optionalAuth'
    );
    expect(body).toContain('external_source IS NULL');
  });

  test('does NOT expose card_comments on the public endpoint', () => {
    // Toggling a board public must not retroactively publish comments written
    // while the board was private.  No SELECT from card_comments may appear
    // in this handler.
    const body = extractRouteBodyWithMiddleware(
      serverSrc, 'get', '/api/public/boards/:listId', 'optionalAuth'
    );
    // The body must contain board_cards (cards are shown) but NOT card_comments.
    expect(body).toContain('board_cards');
    expect(body).not.toContain('card_comments');
  });
});

// ── 7. PUT /api/lists/:listId — visibility field ──────────────────────────

describe('PUT /api/lists/:listId — visibility update', () => {
  const body = extractRouteBody(serverSrc, 'put', '/api/lists/:listId');

  test('destructures visibility from req.body', () => {
    expect(body).toContain('visibility');
  });

  test('UPDATE query includes visibility = COALESCE($13, visibility)', () => {
    // $13 is the positional parameter for visibility in the UPDATE.  This
    // ensures visibility is updated when supplied and left unchanged when
    // omitted (COALESCE semantics).
    expect(body).toContain('visibility         = COALESCE($13, visibility)');
  });

  test("validates that visibility must be 'private' or 'public'", () => {
    // The handler must reject any value outside the allowed enum before
    // touching the database.
    expect(body).toContain("'private'");
    expect(body).toContain("'public'");
    // The validation check must reference both values together.
    expect(body).toMatch(/'private'.*'public'|'public'.*'private'/);
  });

  test('returns 400 for an invalid visibility value', () => {
    // The rejection path must use status(400) so the client gets a clear
    // validation error rather than a silent update or server fault.
    const validationWindow = body.slice(
      body.indexOf("visibility !== undefined"),
      body.indexOf("visibility !== undefined") + 300
    );
    expect(validationWindow).toContain('400');
  });
});
