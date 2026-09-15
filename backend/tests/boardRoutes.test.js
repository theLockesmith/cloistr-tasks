/**
 * Structural tests for board API routes (server.js) and cardAccess helper
 * (lib/access.js).
 *
 * WHY SOURCE-LEVEL:
 * The board routes require a running Postgres database and issued JWTs to
 * exercise at the HTTP level.  Source-level assertions verify structural
 * contracts — middleware presence, access guards, validation, idempotency —
 * without any infrastructure.  If a guard is moved outside its handler, or
 * 'admin' is silently weakened to 'write', these tests catch it immediately.
 *
 * ADMISSION INVARIANT (carried from the project's access test conventions):
 * Every refusal test is paired with a corresponding admission test.  A guard
 * that refuses everyone passes refusal-only tests.  Look for "ADMISSION:"
 * comments below for the positive counterparts.
 *
 * hasAccess() is the one pure function in this area — it is imported and
 * tested directly rather than via source text.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hasAccess } from '../lib/access.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const accessSrc = fs.readFileSync(path.resolve(__dirname, '../lib/access.js'), 'utf8');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the async handler body for `app.<method>('<routePath>', authenticateToken, ...)`.
 * Returns null if the route is not registered or does not wire authenticateToken.
 *
 * The brace-counting walk means the result includes all nested try/catch and
 * inner function bodies, so assertions like `.toContain('23505')` work even
 * for deeply nested checks.
 */
function extractRouteBody(source, method, routePath, middleware = 'authenticateToken') {
  // Escape regex metacharacters in the path (none expected, but be safe).
  const escapedPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(
    `app\\.${method}\\(['"]${escapedPath}['"],\\s*${middleware}`
  );
  const match = source.match(startPattern);
  if (!match) return null;

  // Advance past the match to the first `{` — the opening of the handler body.
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
 * Extract the full body of an exported async function from a module source.
 */
function extractExportedFn(source, name) {
  const funcIdx = source.indexOf(`export async function ${name}`);
  if (funcIdx === -1) return null;

  let i = funcIdx;
  let depth = 0;
  let started = false;
  while (i < source.length) {
    if (source[i] === '{') { depth++; started = true; }
    else if (source[i] === '}') {
      depth--;
      if (started && depth === 0) return source.slice(funcIdx, i + 1);
    }
    i++;
  }
  return null;
}

// ── 1. Route registration + authenticateToken ─────────────────────────────

describe('all board routes are registered with authenticateToken', () => {
  // extractRouteBody returns null if either the route doesn't exist OR if it
  // doesn't pass authenticateToken as the second argument — both failures are
  // caught by a single not.toBeNull() assertion.
  const routes = [
    ['get',    '/api/boards/:listId'],
    ['post',   '/api/boards/:listId/columns'],
    ['put',    '/api/boards/:listId/columns/:columnId'],
    ['delete', '/api/boards/:listId/columns/:columnId'],
    ['post',   '/api/boards/:listId/cards'],
    ['put',    '/api/boards/:listId/cards/:cardId'],
    ['post',   '/api/boards/:listId/cards/:cardId/move'],
    ['delete', '/api/boards/:listId/cards/:cardId'],
    ['get',    '/api/boards/:listId/cards/:cardId/comments'],
    ['post',   '/api/boards/:listId/cards/:cardId/comments'],
    ['put',    '/api/boards/:listId/comments/:commentId'],
    ['delete', '/api/boards/:listId/comments/:commentId'],
  ];

  for (const [method, routePath] of routes) {
    test(`${method.toUpperCase()} ${routePath}`, () => {
      expect(extractRouteBody(serverSrc, method, routePath)).not.toBeNull();
    });
  }
});

// ── 2. Column CRUD — admin-only ───────────────────────────────────────────

describe('column CRUD requires admin access', () => {
  const columnRoutes = [
    ['post',   '/api/boards/:listId/columns'],
    ['put',    '/api/boards/:listId/columns/:columnId'],
    ['delete', '/api/boards/:listId/columns/:columnId'],
  ];

  for (const [method, routePath] of columnRoutes) {
    test(`${method.toUpperCase()} ${routePath} — guards with hasAccess(access, 'admin')`, () => {
      const body = extractRouteBody(serverSrc, method, routePath);
      expect(body).toContain("hasAccess(access, 'admin')");
    });

    test(`${method.toUpperCase()} ${routePath} — does NOT accept write without admin (REFUSAL)`, () => {
      // The guard must require 'admin', not just 'write'.
      // hasAccess('write', 'admin') returns false, so a write-only user must be
      // refused.  We verify by confirming 'admin' is the required level here.
      const body = extractRouteBody(serverSrc, method, routePath);
      // There must be no weaker hasAccess(access, 'write') guard in column routes
      // that could short-circuit before the 'admin' check and admit write users.
      // (A write guard AFTER an admin guard would never be reached for these routes.)
      const adminIdx = body.indexOf("hasAccess(access, 'admin')");
      const writeIdx = body.indexOf("hasAccess(access, 'write')");
      // Either no write guard exists, or the admin guard appears first.
      if (writeIdx !== -1) {
        expect(adminIdx).toBeLessThan(writeIdx);
      } else {
        expect(adminIdx).toBeGreaterThan(-1);
      }
    });
  }

  // ADMISSION: owner and admin access are both admitted (hasAccess hierarchy
  // covers this via the pure hasAccess tests below — owner and admin satisfy 'admin')
});

// ── 3. Card create + move — write access ─────────────────────────────────

describe('card create and move require write access', () => {
  const writeRoutes = [
    ['post', '/api/boards/:listId/cards',            'POST cards'],
    ['put',  '/api/boards/:listId/cards/:cardId',    'PUT card'],
    ['post', '/api/boards/:listId/cards/:cardId/move', 'POST move'],
  ];

  for (const [method, routePath, label] of writeRoutes) {
    test(`${label} — guards with hasAccess(access, 'write')`, () => {
      const body = extractRouteBody(serverSrc, method, routePath);
      expect(body).toContain("hasAccess(access, 'write')");
    });
  }

  // ADMISSION: owner satisfies write — verified in hasAccess section below
});

// ── 4. Card delete — admin only ───────────────────────────────────────────

describe('card delete requires admin access', () => {
  test("DELETE /api/boards/:listId/cards/:cardId guards with hasAccess(access, 'admin')", () => {
    const body = extractRouteBody(serverSrc, 'delete', '/api/boards/:listId/cards/:cardId');
    expect(body).toContain("hasAccess(access, 'admin')");
  });

  test('card delete does not use a weaker write guard (REFUSAL)', () => {
    const body = extractRouteBody(serverSrc, 'delete', '/api/boards/:listId/cards/:cardId');
    // Must not contain a write-level guard that admits write users to delete
    expect(body).not.toContain("hasAccess(access, 'write')");
  });
});

// ── 5. Comment create — write access ──────────────────────────────────────

describe('comment create requires write access', () => {
  test("POST /api/boards/:listId/cards/:cardId/comments guards with hasAccess(access, 'write')", () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/comments');
    expect(body).toContain("hasAccess(access, 'write')");
  });
});

// ── 6. Comment edit/delete — author only ─────────────────────────────────

describe('comment edit and delete are author-only (author_pubkey check)', () => {
  test('PUT comment checks comment.author_pubkey against req.user.id', () => {
    const body = extractRouteBody(serverSrc, 'put', '/api/boards/:listId/comments/:commentId');
    expect(body).toContain('author_pubkey');
    expect(body).toContain('req.user.id');
  });

  test('DELETE comment checks comment.author_pubkey against req.user.id', () => {
    const body = extractRouteBody(serverSrc, 'delete', '/api/boards/:listId/comments/:commentId');
    expect(body).toContain('author_pubkey');
    expect(body).toContain('req.user.id');
  });

  test('PUT comment enforces authorship at the SQL WHERE level (REFUSAL: non-authors get 404)', () => {
    // The implementation enforces author-only via WHERE author_pubkey = req.user.id
    // in the UPDATE query.  A non-author gets 0 rows back → 404 "not yours".
    // This intentionally doesn't leak whether the comment exists at all.
    const body = extractRouteBody(serverSrc, 'put', '/api/boards/:listId/comments/:commentId');
    expect(body).toMatch(/WHERE\s+id\s*=.*AND\s+author_pubkey\s*=/s);
  });

  test('DELETE comment enforces authorship at the SQL WHERE level (REFUSAL: non-authors get 404)', () => {
    const body = extractRouteBody(serverSrc, 'delete', '/api/boards/:listId/comments/:commentId');
    expect(body).toMatch(/WHERE\s+id\s*=.*AND\s+author_pubkey\s*=/s);
  });

  test('PUT comment does NOT use listAccess or cardAccess (author-only, not role-based)', () => {
    // The edit/delete comment routes must not route through the list-sharing
    // permission system — only the author may edit their own comment.
    const body = extractRouteBody(serverSrc, 'put', '/api/boards/:listId/comments/:commentId');
    expect(body).not.toContain('listAccess');
    expect(body).not.toContain('cardAccess');
  });
});

// ── 7. GET board groups cards by column_id ────────────────────────────────

describe('GET /api/boards/:listId — board view structure', () => {
  const body = extractRouteBody(serverSrc, 'get', '/api/boards/:listId');

  test('queries board_columns', () => {
    expect(body).toContain('board_columns');
  });

  test('queries board_cards', () => {
    expect(body).toContain('board_cards');
  });

  test('groups cards by column_id', () => {
    expect(body).toContain('column_id');
    expect(body).toContain('cards');
  });

  test('returns { columns } envelope', () => {
    expect(body).toContain('columns');
    // The res.json call must wrap the result in a columns key
    expect(body).toMatch(/res\.json\(\s*\{.*columns/s);
  });

  test('any non-null access level is admitted (ADMISSION: read users see the board)', () => {
    // The GET board route must not require 'write' or 'owner' — read access is
    // sufficient.  Verify no hasAccess call gating the response.
    expect(body).not.toContain("hasAccess(access, 'write')");
    expect(body).not.toContain("hasAccess(access, 'owner')");
  });
});

// ── 8. Input validation ───────────────────────────────────────────────────

describe('board route input validation', () => {
  test('POST columns rejects a missing or blank name', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/columns');
    expect(body).toContain('Column name is required');
  });

  test('POST cards rejects a missing columnId', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards');
    expect(body).toContain('columnId is required');
  });

  test('POST cards rejects a missing or blank title', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards');
    expect(body).toContain('title is required');
  });

  test('POST cards checks board access before field validation (auth-first ordering)', () => {
    // The handler resolves listAccess before destructuring req.body fields.
    // This means unauthenticated / no-access calls get a 404 before any body
    // parsing, which avoids wasted work on invalid requests.
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards');
    const accessIdx   = body.indexOf('listAccess');
    const columnIdIdx = body.indexOf('columnId is required');
    expect(accessIdx).toBeGreaterThan(-1);
    expect(columnIdIdx).toBeGreaterThan(-1);
    expect(accessIdx).toBeLessThan(columnIdIdx);
  });

  test('POST move rejects a missing columnId', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/move');
    expect(body).toContain('columnId is required');
  });

  test('POST move verifies target column belongs to the board', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/move');
    // Must query board_columns with list_id to prevent cross-board moves
    expect(body).toContain('board_columns');
    expect(body).toContain('list_id');
  });

  test('POST cards verifies column belongs to the board before inserting', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards');
    expect(body).toContain('board_columns');
    expect(body).toContain('list_id');
  });
});

// ── 9. Idempotent external_source handling ────────────────────────────────

describe('idempotent external_source/external_id handling (23505)', () => {
  test('POST cards catches the 23505 unique-key violation', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards');
    expect(body).toContain('23505');
  });

  test('POST cards returns the existing card on duplicate (bridge retry safe)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards');
    // After catching 23505 it must SELECT the existing row and return it
    const after23505 = body.slice(body.indexOf('23505'));
    expect(after23505).toContain('external_source');
    expect(after23505).toContain('external_id');
  });

  test('POST comments catches the 23505 unique-key violation', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/comments');
    expect(body).toContain('23505');
  });

  test('POST comments returns the existing comment on duplicate (bridge retry safe)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/comments');
    const after23505 = body.slice(body.indexOf('23505'));
    expect(after23505).toContain('external_source');
    expect(after23505).toContain('external_id');
  });

  test('card 23505 handler does NOT rethrow (no double-error)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards');
    // The inner catch must not just re-throw on 23505 — it must return a response
    const inner = body.slice(body.indexOf('23505'));
    expect(inner).toContain('return res');
  });
});

// ── 10. cardAccess helper — SQL structure ─────────────────────────────────

describe('cardAccess helper (lib/access.js)', () => {
  const fnBody = extractExportedFn(accessSrc, 'cardAccess');

  test('cardAccess is exported from access.js', () => {
    expect(accessSrc).toContain('export async function cardAccess');
  });

  test('cardAccess joins board_cards as the root table', () => {
    expect(fnBody).toContain('board_cards');
  });

  test('cardAccess joins task_lists to resolve ownership', () => {
    expect(fnBody).toContain('task_lists');
  });

  test('cardAccess LEFT JOINs task_list_shares for share resolution', () => {
    expect(fnBody).toContain('task_list_shares');
    expect(fnBody).toMatch(/LEFT\s+JOIN\s+task_list_shares/i);
  });

  test('cardAccess selects column_id from board_cards', () => {
    expect(fnBody).toContain('column_id');
  });

  test('cardAccess returns { listId, columnId, access } structure', () => {
    expect(fnBody).toContain('listId');
    expect(fnBody).toContain('columnId');
    // access is the resolved permission level
    expect(fnBody).toContain('access');
  });

  test('cardAccess returns null triple when card is not found', () => {
    expect(fnBody).toContain('listId: null');
    expect(fnBody).toContain('columnId: null');
    expect(fnBody).toContain('access: null');
  });

  test('cardAccess resolves owner via CASE WHEN user_id = caller', () => {
    expect(fnBody).toMatch(/CASE\s+WHEN\s+tl\.user_id\s*=\s*\$2\s+THEN\s*'owner'/i);
  });

  test('cardAccess is imported in server.js', () => {
    expect(serverSrc).toContain('cardAccess');
    expect(serverSrc).toMatch(/import\s*\{[^}]*cardAccess[^}]*\}/);
  });
});

// ── 11. hasAccess permission hierarchy ───────────────────────────────────

describe('hasAccess permission hierarchy', () => {
  // ADMISSION tests first — a function that refuses everyone passes
  // refusal-only tests but fails these.

  test('owner ADMITS owner requirement (ADMISSION)', () => {
    expect(hasAccess('owner', 'owner')).toBe(true);
  });

  test('owner ADMITS admin requirement (ADMISSION: owner can do everything admin can)', () => {
    expect(hasAccess('owner', 'admin')).toBe(true);
  });

  test('owner ADMITS write requirement (ADMISSION: owner can do everything write can)', () => {
    expect(hasAccess('owner', 'write')).toBe(true);
  });

  test('owner ADMITS read requirement (ADMISSION)', () => {
    expect(hasAccess('owner', 'read')).toBe(true);
  });

  test('admin ADMITS admin requirement (ADMISSION)', () => {
    expect(hasAccess('admin', 'admin')).toBe(true);
  });

  test('admin ADMITS write requirement (ADMISSION: admin can do everything write can)', () => {
    expect(hasAccess('admin', 'write')).toBe(true);
  });

  test('admin ADMITS read requirement (ADMISSION)', () => {
    expect(hasAccess('admin', 'read')).toBe(true);
  });

  test('write ADMITS write requirement (ADMISSION)', () => {
    expect(hasAccess('write', 'write')).toBe(true);
  });

  test('write ADMITS read requirement (ADMISSION)', () => {
    expect(hasAccess('write', 'read')).toBe(true);
  });

  test('read ADMITS read requirement (ADMISSION)', () => {
    expect(hasAccess('read', 'read')).toBe(true);
  });

  // Refusal tests — confirm the floor is actually enforced

  test('admin does NOT satisfy owner requirement (REFUSAL: admin cannot transfer ownership)', () => {
    expect(hasAccess('admin', 'owner')).toBe(false);
  });

  test('write does NOT satisfy admin requirement (REFUSAL: write cannot manage columns)', () => {
    expect(hasAccess('write', 'admin')).toBe(false);
  });

  test('write does NOT satisfy owner requirement (REFUSAL)', () => {
    expect(hasAccess('write', 'owner')).toBe(false);
  });

  test('read does NOT satisfy write requirement (REFUSAL: read cannot create cards)', () => {
    expect(hasAccess('read', 'write')).toBe(false);
  });

  test('read does NOT satisfy admin requirement (REFUSAL)', () => {
    expect(hasAccess('read', 'admin')).toBe(false);
  });

  test('read does NOT satisfy owner requirement (REFUSAL)', () => {
    expect(hasAccess('read', 'owner')).toBe(false);
  });

  test('null actual returns false (REFUSAL: unauthenticated access)', () => {
    expect(hasAccess(null, 'read')).toBe(false);
  });

  test('null required returns false (defensive: never grant unspecified requirement)', () => {
    expect(hasAccess('owner', null)).toBe(false);
  });

  test('unknown level does not grant access', () => {
    expect(hasAccess('superadmin', 'owner')).toBe(false);
  });
});

// ── 12. Public board route — boundary tests ─────────────────────────────
//
// The unauthenticated branch of GET /api/public/boards/:listId is the only
// thing standing between imported cards (external_source IS NOT NULL) and
// anonymous readers.  Every card the fleet mirror writes carries
// external_source = 'coord', so this predicate is load-bearing.
//
// These tests pin the behaviour so a future refactor cannot quietly widen
// the query.  Filed by cloistr-ops as a consumer of the board.

describe('GET /api/public/boards/:listId — unauthenticated boundary', () => {
  const body = extractRouteBody(serverSrc, 'get', '/api/public/boards/:listId', 'optionalAuth');

  test('public board route is registered with optionalAuth middleware', () => {
    expect(body).not.toBeNull();
  });

  test('unauthenticated branch excludes cards with non-null external_source', () => {
    // The unauthenticated card query MUST contain this predicate.  Without it,
    // every coord-mirrored card would be visible to anonymous readers the moment
    // the board is toggled public.
    expect(body).toContain('external_source IS NULL');
  });

  test('unauthenticated branch does NOT query card_comments', () => {
    // Migration 013 comment: "a toggle should not retroactively publish every
    // comment written while the board was private."  The public route must not
    // SELECT from card_comments at all.
    expect(body).not.toContain('card_comments');
  });

  test('unauthenticated branch only serves boards with visibility = public', () => {
    // The query must filter by visibility = 'public' to prevent serving private
    // boards to unauthenticated callers.
    expect(body).toContain("visibility = 'public'");
  });

  test('authenticated branch still returns external_source cards (ADMISSION)', () => {
    // The authenticated branch (req.user present, access resolved) must NOT
    // filter by external_source — authenticated users with access see everything.
    // We verify by finding the authenticated card query (which includes
    // external_id and external_source columns in its SELECT) and confirming
    // it does NOT contain the IS NULL filter.
    //
    // The handler has two parallel queries: the first (authenticated) returns
    // external_id + external_source columns; the second (unauthenticated) omits
    // them entirely and filters with IS NULL.  Both are in the same handler body.
    //
    // Find the authenticated branch: it selects external_id, external_source
    // as columns (in the SELECT list, not a WHERE clause).
    const firstExternalSelect = body.indexOf('external_id, external_source');
    const externalIsNull = body.indexOf('external_source IS NULL');
    // The unfiltered SELECT of external columns must appear BEFORE the filtered
    // WHERE clause — authenticated branch first, unauthenticated second.
    expect(firstExternalSelect).toBeGreaterThan(-1);
    expect(externalIsNull).toBeGreaterThan(-1);
    expect(firstExternalSelect).toBeLessThan(externalIsNull);
  });
});

// ── 13. PUT /api/lists/:listId — admin access gate ──────────────────────

describe('PUT /api/lists/:listId requires admin access', () => {
  const body = extractRouteBody(serverSrc, 'put', '/api/lists/:listId');

  test('gates with hasAccess(access, admin)', () => {
    expect(body).toContain("hasAccess(access, 'admin')");
  });

  test('calls listAccess before the gate', () => {
    const accessIdx = body.indexOf('listAccess(');
    const gateIdx = body.indexOf("hasAccess(access, 'admin')");
    expect(accessIdx).toBeGreaterThan(-1);
    expect(accessIdx).toBeLessThan(gateIdx);
  });
});

// ── 14. Share endpoints — admin access gate ─────────────────────────────

describe('share endpoints require admin access', () => {
  test("GET /api/lists/:listId/shares guards with hasAccess(access, 'admin')", () => {
    const body = extractRouteBody(serverSrc, 'get', '/api/lists/:listId/shares');
    expect(body).toContain("hasAccess(access, 'admin')");
  });

  test("POST /api/lists/:listId/shares guards with hasAccess(access, 'admin')", () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/lists/:listId/shares');
    expect(body).toContain("hasAccess(access, 'admin')");
  });

  test("DELETE /api/lists/:listId/shares/:pubkey guards with hasAccess(access, 'admin')", () => {
    const body = extractRouteBody(serverSrc, 'delete', '/api/lists/:listId/shares/:pubkey');
    expect(body).toContain("hasAccess(access, 'admin')");
  });

  test('POST shares accepts admin as a valid permission value', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/lists/:listId/shares');
    expect(body).toContain("'admin'");
  });
});

// ── 15. Transfer ownership — owner-only, structural ─────────────────────

describe('transfer ownership endpoint', () => {
  const body = extractRouteBody(serverSrc, 'post', '/api/lists/:listId/transfer');

  test('route is registered', () => {
    expect(body).not.toBeNull();
  });

  test("guards with hasAccess(access, 'owner')", () => {
    expect(body).toContain("hasAccess(access, 'owner')");
  });

  test('does not accept admin (owner-only)', () => {
    // The transfer gate must require owner, not admin.
    expect(body).not.toContain("hasAccess(access, 'admin')");
  });

  test('validates target pubkey format', () => {
    expect(body).toContain('[0-9a-f]{64}');
  });

  test('prevents self-transfer', () => {
    expect(body).toContain('Cannot transfer to yourself');
  });

  test('requires target to have an existing share', () => {
    expect(body).toContain('Target must already have a share');
  });

  test('runs in a transaction (BEGIN/COMMIT)', () => {
    expect(body).toContain('BEGIN');
    expect(body).toContain('COMMIT');
  });

  test('demotes previous owner to admin', () => {
    // The transaction must insert an admin share for the outgoing owner.
    expect(body).toContain("'admin'");
    expect(body).toContain('req.user.id');
  });

  test('transfers ownership by updating user_id', () => {
    expect(body).toContain('UPDATE task_lists SET user_id');
  });

  test('has a ROLLBACK path', () => {
    expect(body).toContain('ROLLBACK');
  });
});

// ── 16. Self-resignation carve-out ──────────────────────────────────────

describe('admin self-resignation carve-out', () => {
  test('admin can remove their own admin share (pubkey === req.user.id bypasses owner gate)', () => {
    const body = extractRouteBody(serverSrc, 'delete', '/api/lists/:listId/shares/:pubkey');
    // The guard checks pubkey !== req.user.id, so matching pubkey is exempted.
    expect(body).toContain('req.user.id');
    // The guard must reference both the permission check AND the self-check.
    const guardWindow = body.slice(
      body.indexOf("Only the owner can remove admin shares") - 300,
      body.indexOf("Only the owner can remove admin shares")
    );
    expect(guardWindow).toContain('pubkey !== req.user.id');
  });
});
