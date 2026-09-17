/**
 * Integration tests for data export/import.
 *
 * Covers:
 *   - GET  /api/user/export returns a version-1 JSON with all user data
 *   - POST /api/user/import creates new lists/templates from exported data
 *   - Round-trip: export → import into a second user → re-export matches
 */

import { jest } from '@jest/globals';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

const USER_A = 'a1'.repeat(32);
const USER_B = 'b2'.repeat(32);

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
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
});

describe('data export/import', () => {
  let exportedData;

  test('seed data for user A', async () => {
    // Create a label
    await request
      .post('/api/labels')
      .set('Authorization', authHeader(USER_A))
      .send({ name: 'Important', color: '#ef4444' })
      .expect(201);

    // Create a recurring list with a template
    const listRes = await request
      .post('/api/lists')
      .set('Authorization', authHeader(USER_A))
      .send({ name: 'Export Test List', list_type: 'recurring' })
      .expect(201);

    await request
      .post(`/api/lists/${listRes.body.id}/templates`)
      .set('Authorization', authHeader(USER_A))
      .send({ name: 'Exported Task', priority: 'high', dueDate: '2027-03-01' })
      .expect(201);

    // Create a board with a card
    const boardRes = await request
      .post('/api/lists')
      .set('Authorization', authHeader(USER_A))
      .send({ name: 'Export Test Board', list_type: 'board' })
      .expect(201);

    const boardData = await request
      .get(`/api/boards/${boardRes.body.id}`)
      .set('Authorization', authHeader(USER_A));

    await request
      .post(`/api/boards/${boardRes.body.id}/cards`)
      .set('Authorization', authHeader(USER_A))
      .send({ columnId: boardData.body.columns[0].id, title: 'Exported Card', priority: 2 })
      .expect(201);
  });

  test('GET /api/user/export returns version-1 JSON', async () => {
    const res = await request
      .get('/api/user/export')
      .set('Authorization', authHeader(USER_A))
      .expect(200)
      .expect('Content-Type', /json/);

    exportedData = res.body;
    expect(exportedData.version).toBe(1);
    expect(exportedData.lists.length).toBeGreaterThanOrEqual(2);
    expect(exportedData.templates.length).toBeGreaterThanOrEqual(1);
    expect(exportedData.labels.length).toBeGreaterThanOrEqual(1);
    expect(exportedData.board_columns.length).toBeGreaterThanOrEqual(3);
    expect(exportedData.board_cards.length).toBeGreaterThanOrEqual(1);
  });

  test('POST /api/user/import creates data for user B', async () => {
    const res = await request
      .post('/api/user/import')
      .set('Authorization', authHeader(USER_B))
      .send(exportedData)
      .expect(200);

    expect(res.body.stats.lists).toBeGreaterThanOrEqual(2);
    expect(res.body.stats.templates).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.labels).toBeGreaterThanOrEqual(1);
  });

  test('user B export contains imported data', async () => {
    const res = await request
      .get('/api/user/export')
      .set('Authorization', authHeader(USER_B))
      .expect(200);

    const listNames = res.body.lists.map(l => l.name);
    expect(listNames).toContain('Export Test List');
    expect(listNames).toContain('Export Test Board');

    const templateNames = res.body.templates.map(t => t.name);
    expect(templateNames).toContain('Exported Task');

    expect(res.body.board_cards.some(c => c.title === 'Exported Card')).toBe(true);
  });

  test('rejects invalid format', async () => {
    await request
      .post('/api/user/import')
      .set('Authorization', authHeader(USER_B))
      .send({ version: 99 })
      .expect(400);
  });
});
