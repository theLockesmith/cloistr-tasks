/**
 * Structural tests for the browser push endpoints (server.js) and their
 * wiring into board activity (card create/move, comment create).
 *
 * WHY SOURCE-LEVEL:
 * Same rationale as boardRoutes.test.js — the push endpoints require a
 * running Postgres to exercise at the HTTP level. Source-level assertions
 * verify structural contracts (middleware presence, upsert semantics,
 * fire-and-forget notification calls) without any infrastructure. Real
 * HTTP-level coverage lives in tests/integration/push-subscriptions.test.js.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const serverSrc = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const notifySrc = fs.readFileSync(path.resolve(__dirname, '../lib/notify.js'), 'utf8');

/**
 * Extract the handler body for `app.<method>('<routePath>', ...)`, optionally
 * requiring a specific middleware as the first argument after the path.
 * Mirrors the helper in boardRoutes.test.js.
 */
function extractRouteBody(source, method, routePath, middleware = null) {
  const escapedPath = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = middleware
    ? new RegExp(`app\\.${method}\\(['"]${escapedPath}['"],\\s*${middleware}`)
    : new RegExp(`app\\.${method}\\(['"]${escapedPath}['"],`);
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

// ── 1. Route registration ──────────────────────────────────────────────

describe('push subscription routes are registered', () => {
  test('GET /api/push/vapid-key is registered WITHOUT authenticateToken', () => {
    // Must be reachable before login — the service worker needs the public
    // key to build a subscription.
    const body = extractRouteBody(serverSrc, 'get', '/api/push/vapid-key');
    expect(body).not.toBeNull();
  });

  test('GET /api/push/vapid-key does NOT wire authenticateToken', () => {
    const gated = extractRouteBody(serverSrc, 'get', '/api/push/vapid-key', 'authenticateToken');
    expect(gated).toBeNull();
  });

  test('POST /api/push/subscribe is registered with authenticateToken', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/push/subscribe', 'authenticateToken');
    expect(body).not.toBeNull();
  });

  test('DELETE /api/push/subscribe is registered with authenticateToken', () => {
    const body = extractRouteBody(serverSrc, 'delete', '/api/push/subscribe', 'authenticateToken');
    expect(body).not.toBeNull();
  });
});

// ── 2. VAPID key endpoint — graceful degradation ─────────────────────────

describe('GET /api/push/vapid-key — graceful degradation', () => {
  const body = extractRouteBody(serverSrc, 'get', '/api/push/vapid-key');

  test('returns 404 when push is not configured', () => {
    expect(body).toContain('pushConfigured');
    expect(body).toMatch(/status\(404\)/);
  });

  test('returns the public key when configured', () => {
    expect(body).toContain('VAPID_PUBLIC_KEY');
    expect(body).toContain('publicKey');
  });
});

// ── 3. Subscribe — validation and upsert ─────────────────────────────────

describe('POST /api/push/subscribe', () => {
  const body = extractRouteBody(serverSrc, 'post', '/api/push/subscribe', 'authenticateToken');

  test('validates endpoint and keys.p256dh/keys.auth are present', () => {
    expect(body).toContain('endpoint');
    expect(body).toContain('keys.p256dh');
    expect(body).toContain('keys.auth');
    expect(body).toMatch(/status\(400\)/);
  });

  test('upserts on endpoint (ON CONFLICT (endpoint))', () => {
    expect(body).toMatch(/ON CONFLICT\s*\(endpoint\)\s*DO UPDATE/i);
  });

  test('saves the subscription under req.user.id', () => {
    expect(body).toContain('req.user.id');
  });

  test('inserts into push_subscriptions', () => {
    expect(body).toContain('push_subscriptions');
  });
});

// ── 4. Unsubscribe — scoped to caller ─────────────────────────────────────

describe('DELETE /api/push/subscribe', () => {
  const body = extractRouteBody(serverSrc, 'delete', '/api/push/subscribe', 'authenticateToken');

  test('requires an endpoint in the body', () => {
    expect(body).toContain('endpoint');
    expect(body).toMatch(/status\(400\)/);
  });

  test('deletes scoped to both endpoint AND the caller pubkey (REFUSAL: cannot delete another user\'s subscription)', () => {
    expect(body).toMatch(/DELETE\s+FROM\s+push_subscriptions\s+WHERE\s+endpoint\s*=.*AND\s+user_pubkey\s*=/is);
    expect(body).toContain('req.user.id');
  });
});

// ── 5. VAPID configuration — graceful degradation at module scope ───────

describe('VAPID configuration in server.js', () => {
  test('reads VAPID keys from env vars', () => {
    expect(serverSrc).toContain('VAPID_PUBLIC_KEY');
    expect(serverSrc).toContain('VAPID_PRIVATE_KEY');
    expect(serverSrc).toContain('VAPID_SUBJECT');
  });

  test('defaults VAPID_SUBJECT to mailto:notifications@cloistr.xyz', () => {
    expect(serverSrc).toContain('mailto:notifications@cloistr.xyz');
  });

  test('does not throw/exit when VAPID keys are absent (graceful degradation)', () => {
    // Unlike JWT_SECRET, a missing VAPID key must not crash the server.
    const vapidSection = serverSrc.slice(
      serverSrc.indexOf('Web Push (VAPID)'),
      serverSrc.indexOf('const app = express()'),
    );
    expect(vapidSection).not.toContain('process.exit');
  });

  test('configures web-push only when both keys are present', () => {
    expect(serverSrc).toMatch(/pushConfigured\s*=\s*Boolean\(VAPID_PUBLIC_KEY\s*&&\s*VAPID_PRIVATE_KEY\)/);
    expect(serverSrc).toContain('webpush.setVapidDetails');
  });
});

// ── 6. Notification triggers — fire and forget ───────────────────────────

describe('board activity triggers notifyBoardContributors (fire-and-forget)', () => {
  test('notifyBoardContributors is imported from lib/notify.js', () => {
    expect(serverSrc).toMatch(/import\s*\{\s*notifyBoardContributors\s*\}\s*from\s*['"]\.\/lib\/notify\.js['"]/);
  });

  test('POST cards calls notifyBoardContributors and does not await it directly into the response path (fire-and-forget .catch)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards', 'authenticateToken');
    expect(body).toContain('notifyBoardContributors(');
    // Must not block the response: no `await notifyBoardContributors(`
    expect(body).not.toMatch(/await\s+notifyBoardContributors/);
    // Must have a .catch to swallow delivery failures
    const idx = body.indexOf('notifyBoardContributors(');
    expect(body.slice(idx, idx + 400)).toContain('.catch(');
  });

  test('POST cards/:cardId/move calls notifyBoardContributors (fire-and-forget)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/move', 'authenticateToken');
    expect(body).toContain('notifyBoardContributors(');
    expect(body).not.toMatch(/await\s+notifyBoardContributors/);
  });

  test('POST cards/:cardId/comments calls notifyBoardContributors (fire-and-forget)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards/:cardId/comments', 'authenticateToken');
    expect(body).toContain('notifyBoardContributors(');
    expect(body).not.toMatch(/await\s+notifyBoardContributors/);
  });

  test('POST boards/:listId/comments (board-level) calls notifyBoardContributors (fire-and-forget)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/comments', 'authenticateToken');
    expect(body).toContain('notifyBoardContributors(');
    expect(body).not.toMatch(/await\s+notifyBoardContributors/);
  });

  test('notification calls happen AFTER the DB write (post-success, matching logActivity ordering)', () => {
    const body = extractRouteBody(serverSrc, 'post', '/api/boards/:listId/cards', 'authenticateToken');
    const logIdx = body.indexOf('logActivity(');
    const notifyIdx = body.indexOf('notifyBoardContributors(');
    expect(logIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(logIdx);
  });
});

// ── 7. lib/notify.js structure ────────────────────────────────────────────

describe('lib/notify.js — notifyBoardContributors structure', () => {
  test('is exported', () => {
    expect(notifySrc).toContain('export async function notifyBoardContributors');
  });

  test('never throws out of the top-level try (defensive wrapper)', () => {
    // The whole body must be wrapped so a bug here cannot 500 the caller.
    const fnStart = notifySrc.indexOf('export async function notifyBoardContributors');
    const fnBody = notifySrc.slice(fnStart);
    expect(fnBody).toContain('try {');
    expect(fnBody).toContain('} catch (error) {');
  });

  test('resolves recipients from task_list_shares UNION task_lists owner', () => {
    expect(notifySrc).toContain('task_list_shares');
    expect(notifySrc).toMatch(/UNION/i);
    expect(notifySrc).toContain('task_lists');
  });

  test('excludes the actor pubkey from recipients', () => {
    expect(notifySrc).toMatch(/pubkey\s*!==\s*actorPubkey|!==\s*actorPubkey/);
  });

  test('looks up push_subscriptions for the recipient set', () => {
    expect(notifySrc).toContain('push_subscriptions');
    expect(notifySrc).toMatch(/= ANY\(\$1\)/);
  });

  test('sends a small payload of title/body/url only', () => {
    expect(notifySrc).toMatch(/JSON\.stringify\(\s*\{\s*title,\s*body,\s*url\s*:/);
  });

  test('deletes the subscription on a 404 or 410 status from the push service', () => {
    expect(notifySrc).toContain('404');
    expect(notifySrc).toContain('410');
    expect(notifySrc).toMatch(/DELETE\s+FROM\s+push_subscriptions\s+WHERE\s+id\s*=/i);
  });

  test('degrades gracefully (no-op) when VAPID keys are not configured', () => {
    expect(notifySrc).toContain('ensureConfigured');
    expect(notifySrc).toMatch(/if\s*\(!ensureConfigured\(\)\)\s*return/);
  });
});
