/**
 * Editing a task with its optional fields left blank must save.
 *
 * The Edit Task form sends every field, and a blank one arrives as "". The
 * create route already turns "" into NULL; the update route passed it
 * straight to Postgres, so estimated_minutes (INTEGER) rejected it and every
 * edit of a task without minutes answered 500 "Failed to update template".
 */

import supertest from 'supertest';
import jwt from 'jsonwebtoken';

import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

const OWNER = 'b'.repeat(64);
const auth = () => `Bearer ${jwt.sign({ pubkey: OWNER }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

let pool, request;

beforeAll(async () => {
  await initializeDatabase();
  pool = createPool(process.env.DB_NAME);
  setPool(pool);
  request = supertest(app);
  await pool.query(
    `INSERT INTO users (id, pubkey, last_login) VALUES ($1, $1, NOW())
     ON CONFLICT (id) DO NOTHING`, [OWNER]);
  await pool.query(
    `INSERT INTO user_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`, [OWNER]);
}, 30_000);

afterAll(async () => { if (pool) await pool.end(); });

async function makeTask(fields = {}) {
  const list = await request.post('/api/lists').set('Authorization', auth()).send({ name: 'blank-fields' });
  const task = await request.post(`/api/lists/${list.body.id}/templates`)
    .set('Authorization', auth()).send({ name: 'task', ...fields });
  return task.body.id;
}

describe('PUT /api/templates/:id with blank optional fields', () => {
  test('the exact body the Edit Task form sends saves, blanks stored as NULL', async () => {
    const id = await makeTask();
    const res = await request.put(`/api/templates/${id}`).set('Authorization', auth()).send({
      name: 'renamed', description: '', timeSlot: '', estimatedMinutes: '',
      priority: 'medium', dueDate: '', recurringDeadline: '',
      reminderOffsetMinutes: null, labelIds: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('renamed');
    expect(res.body.estimated_minutes).toBeNull();
    expect(res.body.time_slot).toBeNull();
  });

  test('clearing minutes on a task that had them stores NULL', async () => {
    const id = await makeTask({ estimatedMinutes: 15, timeSlot: '8:30' });
    const res = await request.put(`/api/templates/${id}`).set('Authorization', auth())
      .send({ estimatedMinutes: '', timeSlot: '' });
    expect(res.status).toBe(200);
    expect(res.body.estimated_minutes).toBeNull();
    expect(res.body.time_slot).toBeNull();
  });

  test('a number given as a string is still stored', async () => {
    const id = await makeTask();
    const res = await request.put(`/api/templates/${id}`).set('Authorization', auth())
      .send({ estimatedMinutes: '20' });
    expect(res.status).toBe(200);
    expect(res.body.estimated_minutes).toBe(20);
  });
});
