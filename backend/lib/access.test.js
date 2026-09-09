import { jest } from '@jest/globals';
/**
 * Tests for the list access control module.
 *
 * hasAccess() is pure logic.  The database-dependent functions (listAccess,
 * templateAccess, taskAccess) are tested against a mock pool that returns
 * controlled rows.
 *
 * THE CRITICAL INVARIANT: a shared user IS admitted.  An access check that
 * returns null for everyone passes every refusal test you can write.  The
 * admission tests below catch that failure mode.
 */

import { hasAccess, listAccess, templateAccess, taskAccess } from './access.js';

// ── hasAccess (pure) ──────────────────────────────────────────────────────

describe('hasAccess', () => {
  test('null actual always fails',    () => expect(hasAccess(null, 'read')).toBe(false));
  test('null required always fails',  () => expect(hasAccess('owner', null)).toBe(false));

  test('owner >= owner',  () => expect(hasAccess('owner', 'owner')).toBe(true));
  test('owner >= write',  () => expect(hasAccess('owner', 'write')).toBe(true));
  test('owner >= read',   () => expect(hasAccess('owner', 'read')).toBe(true));

  test('write >= write',  () => expect(hasAccess('write', 'write')).toBe(true));
  test('write >= read',   () => expect(hasAccess('write', 'read')).toBe(true));
  test('write < owner',   () => expect(hasAccess('write', 'owner')).toBe(false));

  test('read >= read',    () => expect(hasAccess('read', 'read')).toBe(true));
  test('read < write',    () => expect(hasAccess('read', 'write')).toBe(false));
  test('read < owner',    () => expect(hasAccess('read', 'owner')).toBe(false));
});

// ── Mock pool ─────────────────────────────────────────────────────────────

/** Build a mock pool whose query() returns the given rows for any call. */
function mockPool(rows) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

const OWNER_PK   = 'aa'.repeat(32);
const WRITER_PK  = 'bb'.repeat(32);
const READER_PK  = 'cc'.repeat(32);
const NOBODY_PK  = 'dd'.repeat(32);

// ── listAccess ────────────────────────────────────────────────────────────

describe('listAccess', () => {
  test('returns "owner" for the list owner', async () => {
    const pool = mockPool([{ access: 'owner' }]);
    expect(await listAccess(pool, 1, OWNER_PK)).toBe('owner');
  });

  test('returns "write" for a write-shared user (ADMISSION)', async () => {
    const pool = mockPool([{ access: 'write' }]);
    expect(await listAccess(pool, 1, WRITER_PK)).toBe('write');
  });

  test('returns "read" for a read-shared user (ADMISSION)', async () => {
    const pool = mockPool([{ access: 'read' }]);
    expect(await listAccess(pool, 1, READER_PK)).toBe('read');
  });

  test('returns null when list does not exist', async () => {
    const pool = mockPool([]);
    expect(await listAccess(pool, 999, NOBODY_PK)).toBeNull();
  });

  test('returns null when user has no access (row exists, access column is null)', async () => {
    const pool = mockPool([{ access: null }]);
    expect(await listAccess(pool, 1, NOBODY_PK)).toBeNull();
  });
});

// ── templateAccess ────────────────────────────────────────────────────────

describe('templateAccess', () => {
  test('returns owner access through a template', async () => {
    const pool = mockPool([{ list_id: 1, user_id: OWNER_PK, access: 'owner' }]);
    const result = await templateAccess(pool, 10, OWNER_PK);
    expect(result.listId).toBe(1);
    expect(result.access).toBe('owner');
  });

  test('returns write access for shared user through a template (ADMISSION)', async () => {
    const pool = mockPool([{ list_id: 1, user_id: OWNER_PK, access: 'write' }]);
    const result = await templateAccess(pool, 10, WRITER_PK);
    expect(result.listId).toBe(1);
    expect(result.access).toBe('write');
  });

  test('returns read access for shared user through a template (ADMISSION)', async () => {
    const pool = mockPool([{ list_id: 1, user_id: OWNER_PK, access: 'read' }]);
    const result = await templateAccess(pool, 10, READER_PK);
    expect(result.listId).toBe(1);
    expect(result.access).toBe('read');
  });

  test('returns null for nonexistent template', async () => {
    const pool = mockPool([]);
    const result = await templateAccess(pool, 999, NOBODY_PK);
    expect(result.listId).toBeNull();
    expect(result.access).toBeNull();
  });
});

// ── taskAccess ────────────────────────────────────────────────────────────

describe('taskAccess', () => {
  test('returns owner access through a task', async () => {
    const pool = mockPool([{ list_id: 1, access: 'owner' }]);
    const result = await taskAccess(pool, 100, OWNER_PK);
    expect(result.listId).toBe(1);
    expect(result.access).toBe('owner');
  });

  test('returns write access for shared user through a task (ADMISSION)', async () => {
    const pool = mockPool([{ list_id: 1, access: 'write' }]);
    const result = await taskAccess(pool, 100, WRITER_PK);
    expect(result.access).toBe('write');
  });

  test('returns read access for shared user through a task (ADMISSION)', async () => {
    const pool = mockPool([{ list_id: 1, access: 'read' }]);
    const result = await taskAccess(pool, 100, READER_PK);
    expect(result.access).toBe('read');
  });

  test('returns null for nonexistent task', async () => {
    const pool = mockPool([]);
    const result = await taskAccess(pool, 999, NOBODY_PK);
    expect(result.access).toBeNull();
  });
});
