/**
 * Integration tests for the four board defects fixed in 65770090.
 *
 * Each test targets one specific defect and is designed to FAIL against
 * the previous commit (5262f7bc) and PASS against the current code.
 *
 * Setup:  a throwaway Postgres (see setup.js for env vars).
 * Runner: jest --experimental-vm-modules (project is ESM).
 *
 * Schema is bootstrapped via the stock initializeDatabase() path,
 * which is the same code production runs on startup.  No workarounds,
 * no view-dropping harness.  If a migration fails here, it fails in
 * production too, and that is the point.
 *
 * Defect catalogue:
 *   1. Private board via /api/public/boards/:id returns visibility:'private'
 *   2. Reply naming a parent on another board is refused
 *   3. Imported comment collision across boards returns 409 (not leak)
 *   4. Deleting a comment with replies tombstones it, replies survive
 */

import { jest } from '@jest/globals';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// setup.js must run before anything that reads process.env.JWT_SECRET.
import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

// ── Helpers ────────────────────────────────────────────────────────────

const OWNER_PUBKEY  = 'a'.repeat(64);
const WRITER_PUBKEY = 'b'.repeat(64);

function authHeader(pubkey) {
  const token = jwt.sign({ pubkey }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

// ── Global fixtures ────────────────────────────────────────────────────

let pool;
let request;

beforeAll(async () => {
  // Run the stock initializeDatabase(), which creates the DB if needed
  // and applies every migration in filename order.  This is the same
  // code path production takes on pod startup.
  await initializeDatabase();

  // Connect to the test DB and wire up supertest.
  pool = createPool(process.env.DB_NAME);
  setPool(pool);
  request = supertest(app);

  // Seed owner user so syncUser() doesn't fail.
  await pool.query(`
    INSERT INTO users (id, pubkey, last_login)
    VALUES ($1, $1, NOW())
    ON CONFLICT (id) DO NOTHING
  `, [OWNER_PUBKEY]);
  await pool.query(`
    INSERT INTO user_settings (user_id) VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
  `, [OWNER_PUBKEY]);

  // Seed writer user.
  await pool.query(`
    INSERT INTO users (id, pubkey, last_login)
    VALUES ($1, $1, NOW())
    ON CONFLICT (id) DO NOTHING
  `, [WRITER_PUBKEY]);
  await pool.query(`
    INSERT INTO user_settings (user_id) VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
  `, [WRITER_PUBKEY]);
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
});

// ── 1. Private board via sharing route reports visibility: 'private' ───

describe('Defect 1: private board visibility via /api/public/boards', () => {
  let boardId;

  beforeAll(async () => {
    // Create a private board (default visibility).
    const res = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Defect1 Board', list_type: 'board' });
    boardId = res.body.id;

    // Share with the writer so they have access.
    await request
      .post(`/api/lists/${boardId}/shares`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ pubkey: WRITER_PUBKEY, permission: 'write' });
  });

  test('authenticated user with access sees visibility:"private"', async () => {
    const res = await request
      .get(`/api/public/boards/${boardId}`)
      .set('Authorization', authHeader(WRITER_PUBKEY));

    expect(res.status).toBe(200);
    // The defect: the old code hardcoded visibility:'public' on this branch.
    // The fix reads it from the row.
    expect(res.body.visibility).toBe('private');
  });
});

// ── 2. Reply naming a parent on another board is refused ───────────────

describe('Defect 2: cross-board parent_comment_id is refused', () => {
  let boardA, boardB, columnA, columnB, cardA, cardB, commentOnA;

  beforeAll(async () => {
    // Board A
    let res = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Board A', list_type: 'board' });
    boardA = res.body.id;
    // Get auto-created column
    res = await request
      .get(`/api/boards/${boardA}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));
    columnA = res.body.columns[0].id;
    // Card on A
    res = await request
      .post(`/api/boards/${boardA}/cards`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ columnId: columnA, title: 'Card A' });
    cardA = res.body.id;
    // Comment on card A
    res = await request
      .post(`/api/boards/${boardA}/cards/${cardA}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ body: 'Comment on A' });
    commentOnA = res.body.id;

    // Board B
    res = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Board B', list_type: 'board' });
    boardB = res.body.id;
    res = await request
      .get(`/api/boards/${boardB}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));
    columnB = res.body.columns[0].id;
    res = await request
      .post(`/api/boards/${boardB}/cards`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ columnId: columnB, title: 'Card B' });
    cardB = res.body.id;
  });

  test('posting a reply on board B citing a parent from board A returns 400', async () => {
    const res = await request
      .post(`/api/boards/${boardB}/cards/${cardB}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ body: 'Cross-board reply', parentCommentId: commentOnA });

    // The defect: old code did not scope the parent to the card, so this
    // succeeded and linked a comment on board B to a parent on board A.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parent/i);
  });
});

// ── 3. External comment collision across boards returns 409 ────────────

describe('Defect 3: imported comment dedup scoped to the board', () => {
  let boardX, boardY, columnX, columnY, cardX, cardY;

  beforeAll(async () => {
    // Board X
    let res = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Board X', list_type: 'board' });
    boardX = res.body.id;
    res = await request
      .get(`/api/boards/${boardX}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));
    columnX = res.body.columns[0].id;
    res = await request
      .post(`/api/boards/${boardX}/cards`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ columnId: columnX, title: 'Card X' });
    cardX = res.body.id;

    // Board Y
    res = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Board Y', list_type: 'board' });
    boardY = res.body.id;
    res = await request
      .get(`/api/boards/${boardY}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));
    columnY = res.body.columns[0].id;
    res = await request
      .post(`/api/boards/${boardY}/cards`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ columnId: columnY, title: 'Card Y' });
    cardY = res.body.id;

    // Seed a comment with external id on board X.
    await request
      .post(`/api/boards/${boardX}/cards/${cardX}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({
        body: 'Original on X',
        externalSource: 'coord',
        externalId: 'dup-test-1',
      });
  });

  test('same external_id posted to a different board returns 409, not the other board data', async () => {
    const res = await request
      .post(`/api/boards/${boardY}/cards/${cardY}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({
        body: 'Trying on Y',
        externalSource: 'coord',
        externalId: 'dup-test-1',
      });

    // The defect: old code did a global lookup on (external_source, external_id)
    // without checking card_id.  It returned the board-X comment's data to the
    // board-Y requester (information leak).
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/another board/i);
  });
});

// ── 4. Deleting a comment with replies tombstones, replies survive ─────

describe('Defect 4: delete-with-replies tombstones instead of hard-deleting', () => {
  let boardId, columnId, cardId, parentCommentId, childCommentId;

  beforeAll(async () => {
    let res = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Tombstone Board', list_type: 'board' });
    boardId = res.body.id;
    res = await request
      .get(`/api/boards/${boardId}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));
    columnId = res.body.columns[0].id;
    res = await request
      .post(`/api/boards/${boardId}/cards`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ columnId, title: 'Card with thread' });
    cardId = res.body.id;

    // Parent comment
    res = await request
      .post(`/api/boards/${boardId}/cards/${cardId}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ body: 'I am the parent' });
    parentCommentId = res.body.id;

    // Child reply
    res = await request
      .post(`/api/boards/${boardId}/cards/${cardId}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ body: 'I am the reply', parentCommentId: parentCommentId });
    childCommentId = res.body.id;
  });

  test('deleting parent tombstones it and child comment survives', async () => {
    // Delete the parent.
    const delRes = await request
      .delete(`/api/boards/${boardId}/comments/${parentCommentId}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    expect(delRes.status).toBe(204);

    // Fetch all comments on the card.
    const listRes = await request
      .get(`/api/boards/${boardId}/cards/${cardId}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    expect(listRes.status).toBe(200);

    // The parent should still exist (tombstoned).
    const parent = listRes.body.find(c => c.id === parentCommentId);
    expect(parent).toBeDefined();
    expect(parent.body).toBe('');
    expect(parent.deleted_at).not.toBeNull();

    // The child should still exist and be intact.
    const child = listRes.body.find(c => c.id === childCommentId);
    expect(child).toBeDefined();
    expect(child.body).toBe('I am the reply');
    expect(child.parent_comment_id).toBe(parentCommentId);
  });
});
