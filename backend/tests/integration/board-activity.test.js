/**
 * Integration tests for the board activity feed (migration 018).
 *
 * Covers:
 *   - GET /api/boards/:listId/activity returns 200 for a board member
 *   - GET /api/boards/:listId/activity returns 404 for a non-member
 *   - card creation, card move, card deletion, and comment creation each
 *     leave an entry in the feed, newest first
 *
 * Setup:  a throwaway Postgres (see setup.js for env vars).
 * Runner: jest --experimental-vm-modules (project is ESM).
 *
 * Schema is bootstrapped via the stock initializeDatabase() path, same as
 * board-defects.test.js.
 */

import { jest } from '@jest/globals';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// setup.js must run before anything that reads process.env.JWT_SECRET.
import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

// ── Helpers ────────────────────────────────────────────────────────────

const OWNER_PUBKEY     = 'c'.repeat(64);
const NON_MEMBER_PUBKEY = 'd'.repeat(64);

function authHeader(pubkey) {
  const token = jwt.sign({ pubkey }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

// ── Global fixtures ────────────────────────────────────────────────────

let pool;
let request;

beforeAll(async () => {
  await initializeDatabase();

  pool = createPool(process.env.DB_NAME);
  setPool(pool);
  request = supertest(app);

  await pool.query(`
    INSERT INTO users (id, pubkey, last_login)
    VALUES ($1, $1, NOW())
    ON CONFLICT (id) DO NOTHING
  `, [OWNER_PUBKEY]);
  await pool.query(`
    INSERT INTO user_settings (user_id) VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
  `, [OWNER_PUBKEY]);
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
});

describe('board activity feed', () => {
  let boardId, columnAId, columnBId, cardId;

  beforeAll(async () => {
    // Board with two columns so a move has somewhere to go.
    let res = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Activity Board', list_type: 'board' });
    boardId = res.body.id;

    res = await request
      .get(`/api/boards/${boardId}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));
    columnAId = res.body.columns[0].id;

    res = await request
      .post(`/api/boards/${boardId}/columns`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'Second column' });
    columnBId = res.body.id;
  });

  test('GET /api/boards/:listId/activity returns 200 for a board member', async () => {
    const res = await request
      .get(`/api/boards/${boardId}/activity`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/boards/:listId/activity returns 404 for a non-member', async () => {
    const res = await request
      .get(`/api/boards/${boardId}/activity`)
      .set('Authorization', authHeader(NON_MEMBER_PUBKEY));

    expect(res.status).toBe(404);
  });

  test('returns 404 for a nonexistent board', async () => {
    const res = await request
      .get('/api/boards/999999999/activity')
      .set('Authorization', authHeader(OWNER_PUBKEY));

    expect(res.status).toBe(404);
  });

  test('card creation logs a card_created entry', async () => {
    const res = await request
      .post(`/api/boards/${boardId}/cards`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ columnId: columnAId, title: 'Track activity' });
    cardId = res.body.id;

    const activityRes = await request
      .get(`/api/boards/${boardId}/activity`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    expect(activityRes.status).toBe(200);
    const entry = activityRes.body.find(e => e.action === 'card_created' && e.card_id === cardId);
    expect(entry).toBeDefined();
    expect(entry.actor_pubkey).toBe(OWNER_PUBKEY);
    expect(entry.detail).toContain('Track activity');
    expect(entry.list_id).toBe(boardId);
  });

  test('card move logs a card_moved entry', async () => {
    await request
      .post(`/api/boards/${boardId}/cards/${cardId}/move`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ columnId: columnBId });

    const activityRes = await request
      .get(`/api/boards/${boardId}/activity`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    const entry = activityRes.body.find(e => e.action === 'card_moved' && e.card_id === cardId);
    expect(entry).toBeDefined();
    expect(entry.detail).toContain('Second column');
  });

  test('comment creation logs a comment_created entry', async () => {
    await request
      .post(`/api/boards/${boardId}/cards/${cardId}/comments`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ body: 'A note on this card' });

    const activityRes = await request
      .get(`/api/boards/${boardId}/activity`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    const entry = activityRes.body.find(e => e.action === 'comment_created' && e.card_id === cardId);
    expect(entry).toBeDefined();
    expect(entry.detail).toContain('A note on this card');
  });

  test('card deletion logs a card_deleted entry with card_id NULL', async () => {
    await request
      .delete(`/api/boards/${boardId}/cards/${cardId}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    const activityRes = await request
      .get(`/api/boards/${boardId}/activity`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    const entry = activityRes.body.find(e => e.action === 'card_deleted');
    expect(entry).toBeDefined();
    expect(entry.card_id).toBeNull();
    expect(entry.detail).toContain('Track activity');
  });

  test('feed is ordered newest first and capped implicitly at 50', async () => {
    const activityRes = await request
      .get(`/api/boards/${boardId}/activity`)
      .set('Authorization', authHeader(OWNER_PUBKEY));

    const timestamps = activityRes.body.map(e => new Date(e.created_at).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
    expect(activityRes.body.length).toBeLessThanOrEqual(50);
  });
});
