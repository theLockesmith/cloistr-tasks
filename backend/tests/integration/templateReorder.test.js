/**
 * Integration tests for PUT /api/lists/:listId/templates/reorder.
 *
 * Setup:  a throwaway Postgres (see setup.js for env vars).
 * Runner: jest --experimental-vm-modules (project is ESM).
 *
 * Schema is bootstrapped via the stock initializeDatabase() path, which is
 * the same code production runs on startup.
 */

import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// setup.js must run before anything that reads process.env.JWT_SECRET.
import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

// ── Helpers ────────────────────────────────────────────────────────────

const OWNER_PUBKEY    = 'c'.repeat(64);
const STRANGER_PUBKEY = 'd'.repeat(64);

function authHeader(pubkey) {
  const token = jwt.sign({ pubkey }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

let pool;
let request;

beforeAll(async () => {
  await initializeDatabase();

  pool = createPool(process.env.DB_NAME);
  setPool(pool);
  request = supertest(app);

  for (const pubkey of [OWNER_PUBKEY, STRANGER_PUBKEY]) {
    await pool.query(`
      INSERT INTO users (id, pubkey, last_login)
      VALUES ($1, $1, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [pubkey]);
    await pool.query(`
      INSERT INTO user_settings (user_id) VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `, [pubkey]);
  }
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
});

async function createList(pubkey, overrides = {}) {
  const res = await request
    .post('/api/lists')
    .set('Authorization', authHeader(pubkey))
    .send({ name: 'Reorder Test List', list_type: 'recurring', ...overrides });
  return res.body;
}

async function createTemplate(listId, pubkey, name) {
  const res = await request
    .post(`/api/lists/${listId}/templates`)
    .set('Authorization', authHeader(pubkey))
    .send({ name });
  return res.body;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PUT /api/lists/:listId/templates/reorder', () => {
  test('reorder succeeds and persists the new sort_order', async () => {
    const list = await createList(OWNER_PUBKEY);
    const t1 = await createTemplate(list.id, OWNER_PUBKEY, 'First');
    const t2 = await createTemplate(list.id, OWNER_PUBKEY, 'Second');
    const t3 = await createTemplate(list.id, OWNER_PUBKEY, 'Third');

    const res = await request
      .put(`/api/lists/${list.id}/templates/reorder`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ templateIds: [t3.id, t1.id, t2.id] });

    expect(res.status).toBe(200);
    expect(res.body.map(t => t.id)).toEqual([t3.id, t1.id, t2.id]);
    expect(res.body.map(t => t.sort_order)).toEqual([1, 2, 3]);
  });

  test('reorder with invalid (non-existent) template IDs fails with 400', async () => {
    const list = await createList(OWNER_PUBKEY);
    const t1 = await createTemplate(list.id, OWNER_PUBKEY, 'Only task');

    const res = await request
      .put(`/api/lists/${list.id}/templates/reorder`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ templateIds: [t1.id, 999999] });

    expect(res.status).toBe(400);
  });

  test('reorder with a template ID belonging to a different list fails with 400', async () => {
    const listA = await createList(OWNER_PUBKEY);
    const listB = await createList(OWNER_PUBKEY);
    const tA = await createTemplate(listA.id, OWNER_PUBKEY, 'In A');
    const tB = await createTemplate(listB.id, OWNER_PUBKEY, 'In B');

    const res = await request
      .put(`/api/lists/${listA.id}/templates/reorder`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ templateIds: [tA.id, tB.id] });

    expect(res.status).toBe(400);
  });

  test('reorder without access (list not shared with caller) fails with 404', async () => {
    const list = await createList(OWNER_PUBKEY);
    const t1 = await createTemplate(list.id, OWNER_PUBKEY, 'Task');

    const res = await request
      .put(`/api/lists/${list.id}/templates/reorder`)
      .set('Authorization', authHeader(STRANGER_PUBKEY))
      .send({ templateIds: [t1.id] });

    expect(res.status).toBe(404);
  });

  test('reorder with only read access fails with 403', async () => {
    const list = await createList(OWNER_PUBKEY);
    const t1 = await createTemplate(list.id, OWNER_PUBKEY, 'Task');

    await request
      .post(`/api/lists/${list.id}/shares`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ pubkey: STRANGER_PUBKEY, permission: 'read' });

    const res = await request
      .put(`/api/lists/${list.id}/templates/reorder`)
      .set('Authorization', authHeader(STRANGER_PUBKEY))
      .send({ templateIds: [t1.id] });

    expect(res.status).toBe(403);
  });

  test('reorder rejects a missing/empty templateIds array with 400', async () => {
    const list = await createList(OWNER_PUBKEY);

    const res = await request
      .put(`/api/lists/${list.id}/templates/reorder`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ templateIds: [] });

    expect(res.status).toBe(400);
  });
});
