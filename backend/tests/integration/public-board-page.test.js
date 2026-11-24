/**
 * The signed-out public board page (TASKS-49) reads GET /api/public/boards/:id.
 *
 * Two guarantees, each designed to fail against the code before the page:
 *   1. A private board is refused to anyone without access, signed out or not,
 *      with the same 404 as a board that does not exist.
 *   2. A public board, read without access, carries only what the page shows:
 *      board name, column names and colours, and per card its title,
 *      description, priority, due date, tag names/colours and checklist count.
 *      No pubkeys, timestamps, sort keys or internal ids beyond card/column ids.
 *
 * Setup and runner: see board-defects.test.js.
 */

import supertest from 'supertest';
import jwt from 'jsonwebtoken';

import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';

const OWNER = 'c'.repeat(64);
const ASSIGNEE = 'd'.repeat(64);
const STRANGER = 'e'.repeat(64);

const auth = (pubkey) =>
  `Bearer ${jwt.sign({ pubkey }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

let pool;
let request;

async function seedUser(pubkey) {
  await pool.query(
    'INSERT INTO users (id, pubkey, last_login) VALUES ($1, $1, NOW()) ON CONFLICT (id) DO NOTHING',
    [pubkey],
  );
  await pool.query(
    'INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
    [pubkey],
  );
}

async function makeBoard(name, visibility) {
  let res = await request.post('/api/lists').set('Authorization', auth(OWNER))
    .send({ name, list_type: 'board' });
  const boardId = res.body.id;
  if (visibility === 'public') {
    res = await request.put(`/api/lists/${boardId}`).set('Authorization', auth(OWNER))
      .send({ visibility: 'public' });
    expect(res.status).toBe(200);
  }
  res = await request.get(`/api/boards/${boardId}`).set('Authorization', auth(OWNER));
  const columnId = res.body.columns[0].id;
  res = await request.post(`/api/boards/${boardId}/cards`).set('Authorization', auth(OWNER))
    .send({
      columnId, title: 'Visible card', description: 'Some **detail**',
      priority: 'high', dueDate: '2026-12-01', assigneePubkey: ASSIGNEE,
    });
  const cardId = res.body.id;
  res = await request.post(`/api/boards/${boardId}/tags`).set('Authorization', auth(OWNER))
    .send({ name: 'urgent', color: '#ff0000' });
  await request.post(`/api/boards/${boardId}/cards/${cardId}/tags`).set('Authorization', auth(OWNER))
    .send({ tagId: res.body.id });
  await request.post(`/api/boards/${boardId}/cards/${cardId}/checklist`).set('Authorization', auth(OWNER))
    .send({ text: 'step one' });
  return { boardId, columnId, cardId };
}

beforeAll(async () => {
  await initializeDatabase();
  pool = createPool(process.env.DB_NAME);
  setPool(pool);
  request = supertest(app);
  for (const pk of [OWNER, ASSIGNEE, STRANGER]) await seedUser(pk);
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
});

describe('a private board is refused without access', () => {
  let board;
  beforeAll(async () => { board = await makeBoard('Private board', 'private'); });

  test('signed out: 404, nothing about the board in the body', async () => {
    const res = await request.get(`/api/public/boards/${board.boardId}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Private board|Visible card/);
  });

  test('signed in without access: the same 404', async () => {
    const res = await request.get(`/api/public/boards/${board.boardId}`)
      .set('Authorization', auth(STRANGER));
    expect(res.status).toBe(404);
  });

  test('indistinguishable from a board that does not exist', async () => {
    const missing = await request.get('/api/public/boards/999999');
    const priv = await request.get(`/api/public/boards/${board.boardId}`);
    expect(priv.status).toBe(missing.status);
    expect(priv.body).toEqual(missing.body);
  });
});

describe('a public board exposes only what the signed-out page shows', () => {
  let board;
  beforeAll(async () => { board = await makeBoard('Public board', 'public'); });

  const sorted = (o) => Object.keys(o).sort();

  async function expectMinimal(res) {
    expect(res.status).toBe(200);
    expect(sorted(res.body)).toEqual(['board', 'columns']);
    expect(res.body.board).toEqual({ id: board.boardId, name: 'Public board' });

    const [col] = res.body.columns;
    expect(sorted(col)).toEqual(['cards', 'color', 'id', 'name']);

    const [card] = col.cards;
    expect(sorted(card)).toEqual(
      ['checklist', 'description', 'due_date', 'id', 'priority', 'tags', 'title'],
    );
    expect(card.title).toBe('Visible card');
    expect(card.tags).toEqual([{ name: 'urgent', color: '#ff0000' }]);
    expect(card.checklist).toEqual({ done: 0, total: 1 });

    const raw = JSON.stringify(res.body);
    for (const pk of [OWNER, ASSIGNEE]) expect(raw).not.toContain(pk);
    expect(raw).not.toMatch(/created_at|updated_at|sort_order|pubkey|access|visibility/);
  }

  test('signed out', async () => {
    await expectMinimal(await request.get(`/api/public/boards/${board.boardId}`));
  });

  test('signed in without access gets the same minimal view', async () => {
    await expectMinimal(
      await request.get(`/api/public/boards/${board.boardId}`).set('Authorization', auth(STRANGER)),
    );
  });

  test('a card imported from an external source is left out', async () => {
    await request.post(`/api/boards/${board.boardId}/cards`).set('Authorization', auth(OWNER))
      .send({ columnId: board.columnId, title: 'Imported', externalId: 'x1', externalSource: 'gh' });
    const res = await request.get(`/api/public/boards/${board.boardId}`);
    expect(JSON.stringify(res.body)).not.toContain('Imported');
  });
});
