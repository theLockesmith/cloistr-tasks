/**
 * Integration tests for the iCal feed (migration 020).
 *
 * Covers:
 *   - POST /api/user/ical-token generates a token
 *   - GET  /api/user/ical-token returns the current token
 *   - GET  /api/ical/:token.ics serves a valid iCalendar file
 *   - GET  /api/ical/:token.ics includes tasks with due dates
 *   - GET  /api/ical/:token.ics includes board cards with due dates
 *   - DELETE /api/user/ical-token revokes the token
 *   - GET  /api/ical/:token.ics returns 404 after revocation
 */

import { jest } from '@jest/globals';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

const OWNER_PUBKEY = 'e'.repeat(64);

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

describe('iCal token management', () => {
  let token;

  test('POST /api/user/ical-token generates a token', async () => {
    const res = await request
      .post('/api/user/ical-token')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .expect(200);

    expect(res.body.ical_token).toMatch(/^[0-9a-f]{64}$/);
    token = res.body.ical_token;
  });

  test('GET /api/user/ical-token returns the current token', async () => {
    const res = await request
      .get('/api/user/ical-token')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .expect(200);

    expect(res.body.ical_token).toBe(token);
  });

  test('GET /api/ical/:token.ics returns valid iCalendar', async () => {
    const res = await request
      .get(`/api/ical/${token}.ics`)
      .expect(200)
      .expect('Content-Type', /text\/calendar/);

    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('END:VCALENDAR');
    expect(res.text).toContain('PRODID:-//Cloistr//Ritual Forge//EN');
  });

  test('DELETE /api/user/ical-token revokes it', async () => {
    await request
      .delete('/api/user/ical-token')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .expect(204);
  });

  test('GET /api/ical/:token.ics returns 404 after revocation', async () => {
    await request
      .get(`/api/ical/${token}.ics`)
      .expect(404);
  });
});

describe('iCal feed content', () => {
  let token;
  let listId;

  beforeAll(async () => {
    // Generate a fresh token
    const tokenRes = await request
      .post('/api/user/ical-token')
      .set('Authorization', authHeader(OWNER_PUBKEY));
    token = tokenRes.body.ical_token;

    // Create a recurring list with a template that has a due date
    const listRes = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'iCal Test List', list_type: 'recurring' });
    listId = listRes.body.id;

    await request
      .post(`/api/lists/${listId}/templates`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({
        name: 'Task With Due Date',
        description: 'Test description',
        priority: 'high',
        dueDate: '2026-12-25',
        estimatedMinutes: 45,
      });

    // Create a board with a card that has a due date
    const boardRes = await request
      .post('/api/lists')
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({ name: 'iCal Test Board', list_type: 'board' });
    const boardId = boardRes.body.id;

    const boardData = await request
      .get(`/api/boards/${boardId}`)
      .set('Authorization', authHeader(OWNER_PUBKEY));
    const columnId = boardData.body.columns[0].id;

    await request
      .post(`/api/boards/${boardId}/cards`)
      .set('Authorization', authHeader(OWNER_PUBKEY))
      .send({
        columnId,
        title: 'Card With Due Date',
        dueDate: '2027-01-15',
        priority: 3,
      });
  });

  test('feed includes task template with due date', async () => {
    const res = await request
      .get(`/api/ical/${token}.ics`)
      .expect(200);

    expect(res.text).toContain('SUMMARY:Task With Due Date');
    expect(res.text).toContain('DTSTART;VALUE=DATE:20261225');
    expect(res.text).toContain('PRIORITY:1');
    expect(res.text).toContain('DURATION:PT45M');
    expect(res.text).toContain('CATEGORIES:iCal Test List');
  });

  test('feed includes board card with due date', async () => {
    const res = await request
      .get(`/api/ical/${token}.ics`)
      .expect(200);

    expect(res.text).toContain('SUMMARY:Card With Due Date');
    expect(res.text).toContain('DTSTART;VALUE=DATE:20270115');
    expect(res.text).toContain('CATEGORIES:iCal Test Board');
  });

  test('invalid token format returns 400', async () => {
    await request.get('/api/ical/not-a-valid-token.ics').expect(400);
  });

  test('unknown token returns 404', async () => {
    await request.get(`/api/ical/${'f'.repeat(64)}.ics`).expect(404);
  });
});
