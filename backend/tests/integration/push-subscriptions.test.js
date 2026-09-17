/**
 * Integration tests for the push subscription endpoints (migration 021).
 *
 * Covers:
 *   - GET /api/push/vapid-key: 404 when VAPID isn't configured (this test's
 *     env, per setup.js, never sets VAPID_PUBLIC_KEY/PRIVATE_KEY)
 *   - POST /api/push/subscribe: creates a row, requires auth, validates body
 *   - POST /api/push/subscribe: upserts on endpoint (same endpoint twice
 *     updates the existing row rather than duplicating it)
 *   - DELETE /api/push/subscribe: removes the caller's own subscription and
 *     leaves subscriptions owned by other users alone
 *
 * Setup: a throwaway Postgres (see tests/integration/setup.js for env vars).
 * Runner: jest --experimental-vm-modules (project is ESM).
 */

import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// setup.js must run before anything that reads process.env.JWT_SECRET.
import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

const USER_A = 'e'.repeat(64);
const USER_B = 'f'.repeat(64);

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

  for (const pubkey of [USER_A, USER_B]) {
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
}, 30000);

afterAll(async () => {
  if (pool) await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM push_subscriptions');
});

describe('GET /api/push/vapid-key', () => {
  test('requires no authentication', async () => {
    const res = await request.get('/api/push/vapid-key');
    expect([200, 404]).toContain(res.status);
  });

  test('returns 404 when VAPID keys are not configured in this test env', async () => {
    const res = await request.get('/api/push/vapid-key');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe('POST /api/push/subscribe', () => {
  test('requires authentication', async () => {
    const res = await request
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } });
    expect(res.status).toBe(401);
  });

  test('rejects a missing endpoint', async () => {
    const res = await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ keys: { p256dh: 'p', auth: 'a' } });
    expect(res.status).toBe(400);
  });

  test('rejects missing keys', async () => {
    const res = await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint: 'https://push.example/a' });
    expect(res.status).toBe(400);
  });

  test('rejects keys missing p256dh', async () => {
    const res = await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint: 'https://push.example/a', keys: { auth: 'a' } });
    expect(res.status).toBe(400);
  });

  test('creates a subscription row for the caller', async () => {
    const res = await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint: 'https://push.example/create', keys: { p256dh: 'p1', auth: 'a1' } });

    expect(res.status).toBe(201);

    const row = await pool.query(
      'SELECT * FROM push_subscriptions WHERE endpoint = $1',
      ['https://push.example/create'],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].user_pubkey).toBe(USER_A);
    expect(row.rows[0].p256dh).toBe('p1');
    expect(row.rows[0].auth).toBe('a1');
  });

  test('upserts on endpoint: subscribing the same endpoint again updates rather than duplicates', async () => {
    const endpoint = 'https://push.example/upsert';
    await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint, keys: { p256dh: 'old-p', auth: 'old-a' } });

    const res2 = await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint, keys: { p256dh: 'new-p', auth: 'new-a' } });

    expect(res2.status).toBe(201);

    const rows = await pool.query('SELECT * FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].p256dh).toBe('new-p');
    expect(rows.rows[0].auth).toBe('new-a');
  });

  test('re-subscribing under a different user reassigns ownership', async () => {
    const endpoint = 'https://push.example/reassign';
    await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

    await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_B))
      .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

    const rows = await pool.query('SELECT * FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].user_pubkey).toBe(USER_B);
  });
});

describe('DELETE /api/push/subscribe', () => {
  test('requires authentication', async () => {
    const res = await request
      .delete('/api/push/subscribe')
      .send({ endpoint: 'https://push.example/del' });
    expect(res.status).toBe(401);
  });

  test('rejects a missing endpoint', async () => {
    const res = await request
      .delete('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({});
    expect(res.status).toBe(400);
  });

  test('removes the caller own subscription', async () => {
    const endpoint = 'https://push.example/mine';
    await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

    const res = await request
      .delete('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint });

    expect(res.status).toBe(204);

    const rows = await pool.query('SELECT * FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    expect(rows.rows).toHaveLength(0);
  });

  test('does not remove a subscription owned by a different user', async () => {
    const endpoint = 'https://push.example/not-yours';
    await request
      .post('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

    const res = await request
      .delete('/api/push/subscribe')
      .set('Authorization', authHeader(USER_B))
      .send({ endpoint });

    expect(res.status).toBe(204);

    const rows = await pool.query('SELECT * FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].user_pubkey).toBe(USER_A);
  });

  test('deleting a nonexistent endpoint is a no-op 204', async () => {
    const res = await request
      .delete('/api/push/subscribe')
      .set('Authorization', authHeader(USER_A))
      .send({ endpoint: 'https://push.example/never-existed' });
    expect(res.status).toBe(204);
  });
});

describe('board activity does not fail when push is unconfigured', () => {
  test('card creation still succeeds', async () => {
    const listRes = await request
      .post('/api/lists')
      .set('Authorization', authHeader(USER_A))
      .send({ name: 'Push smoke test board', list_type: 'board' });
    const boardId = listRes.body.id;

    const boardRes = await request
      .get(`/api/boards/${boardId}`)
      .set('Authorization', authHeader(USER_A));
    const columnId = boardRes.body.columns[0].id;

    const cardRes = await request
      .post(`/api/boards/${boardId}/cards`)
      .set('Authorization', authHeader(USER_A))
      .send({ columnId, title: 'Card that should not be blocked by push' });

    expect(cardRes.status).toBe(201);
  });
});
