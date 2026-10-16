/**
 * GET /api/cards?assignee=me: the caller's cards across every board they can
 * read, for Space's Activity widget. Covers:
 *
 *   - only boards the caller can read (owned, or shared with them); a card
 *     assigned to them on a board they cannot read never appears
 *   - cards in an is_done column are left out unless ?include_done=1
 *   - auth by Bearer JWT AND by NIP-98, with NIP-98 refusing a wrong URL,
 *     wrong method, stale event, wrong kind, bad signature and a replay
 *   - migration 023's done-name rule and its down file
 *
 * Schema comes from the stock initializeDatabase(), the same path production
 * takes on startup.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, '../../database/migrations');

process.env.APP_URL = 'https://tasks.test';

const SK = generateSecretKey();
const ME = getPublicKey(SK);
const OTHER = 'd'.repeat(64);

const bearer = (pubkey) => `Bearer ${jwt.sign({ pubkey }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;

function nip98(url, { method = 'GET', kind = 27235, ageSeconds = 0, sk = SK } = {}) {
  const event = finalizeEvent({
    kind,
    created_at: Math.floor(Date.now() / 1000) - ageSeconds,
    tags: [['u', url], ['method', method]],
    content: '',
  }, sk);
  return 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64');
}

let pool, request;
const ids = {};

async function seedUser(pk) {
  await pool.query(`INSERT INTO users (id, pubkey, last_login) VALUES ($1, $1, NOW()) ON CONFLICT (id) DO NOTHING`, [pk]);
  await pool.query(`INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [pk]);
}

// Boards go through the API so their default columns (To Do / In Progress /
// Done) come from the real creation path.
async function makeBoard(owner, name) {
  const list = await request.post('/api/lists').set('Authorization', bearer(owner)).send({ name, list_type: 'board' });
  const board = await request.get(`/api/boards/${list.body.id}`).set('Authorization', bearer(owner));
  const col = (n) => board.body.columns.find(c => c.name === n).id;
  return { listId: list.body.id, todo: col('To Do'), done: col('Done') };
}

async function makeCard(board, columnId, title, assignee, due = null) {
  const r = await pool.query(
    `INSERT INTO board_cards (column_id, list_id, title, author_pubkey, assignee_pubkey, due_date)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [columnId, board.listId, title, OTHER, assignee, due]);
  return r.rows[0].id;
}

beforeAll(async () => {
  await initializeDatabase();
  pool = createPool(process.env.DB_NAME);
  setPool(pool);
  request = supertest(app);
  await seedUser(ME);
  await seedUser(OTHER);

  const mine = await makeBoard(ME, 'My board');
  ids.open = await makeCard(mine, mine.todo, 'Open card, mine', ME, '2026-11-01');
  ids.done = await makeCard(mine, mine.done, 'Finished card, mine', ME);
  ids.othersCard = await makeCard(mine, mine.todo, 'Assigned to someone else', OTHER);

  const shared = await makeBoard(OTHER, 'Shared with me');
  await pool.query(`INSERT INTO task_list_shares (list_id, pubkey, permission) VALUES ($1, $2, 'read')`, [shared.listId, ME]);
  ids.shared = await makeCard(shared, shared.todo, 'On a shared board', ME);

  const hidden = await makeBoard(OTHER, 'Not shared with me');
  ids.hidden = await makeCard(hidden, hidden.todo, 'Assigned to me, board hidden', ME);

  const archived = await makeBoard(ME, 'Archived board');
  await pool.query(`UPDATE task_lists SET active = false WHERE id = $1`, [archived.listId]);
  ids.archived = await makeCard(archived, archived.todo, 'On an inactive board', ME);
}, 60_000);

afterAll(async () => { if (pool) await pool.end(); });

const idsOf = (body) => body.map(c => c.id).sort((a, b) => a - b);

describe('GET /api/cards?assignee=me with a Bearer JWT', () => {
  test('lists my open cards on boards I own or that are shared with me', async () => {
    const res = await request.get('/api/cards?assignee=me').set('Authorization', bearer(ME));
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([ids.open, ids.shared].sort((a, b) => a - b));
  });

  test('a card on a board I cannot read never appears, even with include_done', async () => {
    for (const q of ['', '&include_done=1']) {
      const res = await request.get('/api/cards?assignee=me' + q).set('Authorization', bearer(ME));
      expect(res.body.map(c => c.id)).not.toContain(ids.hidden);
      expect(res.body.map(c => c.title)).not.toContain('Assigned to me, board hidden');
    }
  });

  test("cards in a Done column are left out by default, included with include_done=1", async () => {
    const def = await request.get('/api/cards?assignee=me').set('Authorization', bearer(ME));
    expect(def.body.map(c => c.id)).not.toContain(ids.done);
    const all = await request.get('/api/cards?assignee=me&include_done=1').set('Authorization', bearer(ME));
    expect(idsOf(all.body)).toEqual([ids.open, ids.done, ids.shared].sort((a, b) => a - b));
  });

  test('cards assigned to others and cards on inactive boards are left out', async () => {
    const res = await request.get('/api/cards?assignee=me&include_done=1').set('Authorization', bearer(ME));
    expect(res.body.map(c => c.id)).not.toContain(ids.othersCard);
    expect(res.body.map(c => c.id)).not.toContain(ids.archived);
  });

  test('each card has the agreed shape, with its /card/<id> link', async () => {
    const res = await request.get('/api/cards?assignee=me').set('Authorization', bearer(ME));
    const card = res.body.find(c => c.id === ids.open);
    expect(card).toEqual({
      id: ids.open,
      title: 'Open card, mine',
      list_id: expect.any(Number),
      board_name: 'My board',
      column_name: 'To Do',
      due_date: '2026-11-01',
      url: '/card/' + ids.open,
    });
    expect(res.body.find(c => c.id === ids.shared).due_date).toBeNull();
  });

  test('only assignee=me is supported', async () => {
    const res = await request.get('/api/cards?assignee=' + OTHER).set('Authorization', bearer(ME));
    expect(res.status).toBe(400);
  });

  test('no credentials, no list', async () => {
    const res = await request.get('/api/cards?assignee=me');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cards with NIP-98', () => {
  const URL = 'https://tasks.test/api/cards?assignee=me';

  test('a correctly signed request is accepted and returns the same cards', async () => {
    const res = await request.get('/api/cards?assignee=me').set('Authorization', nip98(URL));
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([ids.open, ids.shared].sort((a, b) => a - b));
  });

  test('the same signed event used twice is refused the second time', async () => {
    // A different created_at from the test above: NIP-98 event ids are
    // deterministic, so the same URL signed in the same second IS a replay.
    const header = nip98(URL, { ageSeconds: 5 });
    const first = await request.get('/api/cards?assignee=me').set('Authorization', header);
    expect(first.status).toBe(200);
    const replay = await request.get('/api/cards?assignee=me').set('Authorization', header);
    expect(replay.status).toBe(401);
  });

  test('a signature over a different URL is refused (query string included)', async () => {
    const res = await request.get('/api/cards?assignee=me&include_done=1').set('Authorization', nip98(URL));
    expect(res.status).toBe(401);
    const otherHost = await request.get('/api/cards?assignee=me')
      .set('Authorization', nip98('https://evil.test/api/cards?assignee=me'));
    expect(otherHost.status).toBe(401);
  });

  test('a signature for a different method is refused', async () => {
    const res = await request.get('/api/cards?assignee=me').set('Authorization', nip98(URL, { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  test('an event older than 60 seconds is refused', async () => {
    const res = await request.get('/api/cards?assignee=me').set('Authorization', nip98(URL, { ageSeconds: 120 }));
    expect(res.status).toBe(401);
  });

  test('an event of another kind is refused', async () => {
    const res = await request.get('/api/cards?assignee=me').set('Authorization', nip98(URL, { kind: 1 }));
    expect(res.status).toBe(401);
  });

  test('a tampered event is refused', async () => {
    const event = JSON.parse(Buffer.from(nip98(URL).slice(6), 'base64').toString());
    event.pubkey = OTHER;
    const res = await request.get('/api/cards?assignee=me')
      .set('Authorization', 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64'));
    expect(res.status).toBe(401);
  });

  test('NIP-98 is not accepted on any other endpoint', async () => {
    const res = await request.get('/api/lists')
      .set('Authorization', nip98('https://tasks.test/api/lists'));
    expect(res.status).not.toBe(200);
  });
});

describe('migration 023 (column is_done)', () => {
  const up = fs.readFileSync(path.join(MIGRATIONS, '023_column_is_done.sql'), 'utf8');
  const down = fs.readFileSync(path.join(MIGRATIONS, 'down/023_column_is_done.sql'), 'utf8');

  test('marks Done / Closed / Complete (any case, trimmed) and nothing else; down removes it', async () => {
    const board = await makeBoard(OTHER, 'Migration board');
    const names = ['done', ' CLOSED ', 'Complete', 'Doing', 'Completed', 'Not done'];
    const colIds = [];
    for (const n of names) {
      const r = await pool.query(
        `INSERT INTO board_columns (list_id, name, sort_order) VALUES ($1, $2, 9) RETURNING id`, [board.listId, n]);
      colIds.push(r.rows[0].id);
    }

    await pool.query(down);
    const gone = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'board_columns' AND column_name = 'is_done'`);
    expect(gone.rowCount).toBe(0);

    await pool.query(up);
    const r = await pool.query(`SELECT id, is_done FROM board_columns WHERE id = ANY($1)`, [colIds]);
    const byId = Object.fromEntries(r.rows.map(x => [x.id, x.is_done]));
    expect(colIds.map(id => byId[id])).toEqual([true, true, true, false, false, false]);
  });
});
