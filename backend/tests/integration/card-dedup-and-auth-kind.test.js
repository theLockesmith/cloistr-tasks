/**
 * Two defects that block the coordination cutover.
 *
 * 1. CARD DEDUP WAS GLOBAL, NOT PER BOARD. idx_board_cards_external was
 *    UNIQUE (external_source, external_id) with no list_id, so a client whose
 *    key is not globally unique could not get a card on its own board: the
 *    insert violated the index and the endpoint answered with ANOTHER BOARD'S
 *    CARD. Migration 022 puts the board in the key; the handler scopes its
 *    duplicate lookup to match.
 *
 * 2. THE LOGIN ENDPOINT NEVER CHECKED THE EVENT KIND. It verified the
 *    signature and the challenge and accepted any numeric kind, so a signature
 *    over a public note carrying the right content was a credential.
 *
 * Both are written to FAIL against the previous commit and pass against this
 * one. Schema comes from the stock initializeDatabase(), the same path
 * production takes on startup.
 */

import { jest } from '@jest/globals';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const OWNER = 'c'.repeat(64);

function authHeader(pubkey) {
  return `Bearer ${jwt.sign({ pubkey }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}

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

async function makeBoard(name) {
  const list = await request.post('/api/lists')
    .set('Authorization', authHeader(OWNER))
    .send({ name, list_type: 'board' });
  const board = await request.get(`/api/boards/${list.body.id}`)
    .set('Authorization', authHeader(OWNER));
  return { listId: list.body.id, columnId: board.body.columns[0].id };
}

// ── 1. card dedup is per board ────────────────────────────────────────

describe('card idempotency is scoped to the board', () => {
  let A, B;
  const KEY = 'update-the-docs';

  beforeAll(async () => {
    A = await makeBoard('dedup board A');
    B = await makeBoard('dedup board B');
  });

  test('the same external key on a DIFFERENT board creates its own card', async () => {
    const first = await request.post(`/api/boards/${A.listId}/cards`)
      .set('Authorization', authHeader(OWNER))
      .send({ columnId: A.columnId, title: 'Update the docs (group A)',
              description: 'A private to group A',
              externalSource: 'arbiter', externalId: KEY });
    expect(first.status).toBe(201);

    const second = await request.post(`/api/boards/${B.listId}/cards`)
      .set('Authorization', authHeader(OWNER))
      .send({ columnId: B.columnId, title: 'Update the docs (group B)',
              description: 'B private to group B',
              externalSource: 'arbiter', externalId: KEY });

    // THE DEFECT: the old global index made this a 200 carrying board A's row,
    // so group B never got a card and was handed group A's instruction.
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.list_id).toBe(B.listId);
    expect(second.body.title).toBe('Update the docs (group B)');
    expect(second.body.description).not.toContain('private to group A');
  });

  test('the same external key TWICE on the SAME board is still idempotent', async () => {
    const one = await request.post(`/api/boards/${A.listId}/cards`)
      .set('Authorization', authHeader(OWNER))
      .send({ columnId: A.columnId, title: 'Idempotent',
              externalSource: 'arbiter', externalId: 'same-board-key' });
    expect(one.status).toBe(201);

    const two = await request.post(`/api/boards/${A.listId}/cards`)
      .set('Authorization', authHeader(OWNER))
      .send({ columnId: A.columnId, title: 'Idempotent, said twice',
              externalSource: 'arbiter', externalId: 'same-board-key' });

    expect(two.status).toBe(200);
    expect(two.body.id).toBe(one.body.id);
    expect(two.body.list_id).toBe(A.listId);
    // The first writer's content wins; the second call's title is discarded.
    expect(two.body.title).toBe('Idempotent');
  });

  test('a duplicate answer never carries a row from another board', async () => {
    const res = await request.post(`/api/boards/${B.listId}/cards`)
      .set('Authorization', authHeader(OWNER))
      .send({ columnId: B.columnId, title: 'again on B',
              externalSource: 'arbiter', externalId: KEY });
    expect(res.status).toBe(200);
    expect(res.body.list_id).toBe(B.listId);
  });
});

// ── 2. the login endpoint pins the event kind ─────────────────────────

describe('/api/auth/verify pins the NIP-98 event kind', () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  async function challenge() {
    const res = await request.get('/api/auth/challenge');
    return res.body;
  }

  function loginEvent({ challenge: c, nonce }, kind) {
    return finalizeEvent({
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['challenge', c], ['nonce', nonce]],
      content: JSON.stringify({ challenge: c, nonce }),
    }, sk);
  }

  test('a correctly signed kind-27235 event still logs in', async () => {
    const issued = await challenge();
    const res = await request.post('/api/auth/verify')
      .send({ signedEvent: loginEvent(issued, 27235) });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.user.pubkey).toBe(pk);
  });

  test('THE DEFECT: the same content signed as a public note is refused', async () => {
    const issued = await challenge();
    const event = loginEvent(issued, 1);           // kind 1 is a public note
    // The signature is genuine and the challenge is valid and unused; the only
    // thing wrong is the kind. Before this fix that combination logged in.
    const res = await request.post('/api/auth/verify').send({ signedEvent: event });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/27235/);
  });

  test('a profile event carrying the challenge is refused too', async () => {
    const issued = await challenge();
    const res = await request.post('/api/auth/verify')
      .send({ signedEvent: loginEvent(issued, 0) });
    expect(res.status).toBe(400);
  });

  test('the refusal happens BEFORE the challenge is spent', async () => {
    // Otherwise a rejected attempt would burn the challenge and the honest
    // retry would fail with "invalid or expired", which reads as a broken
    // login rather than a refused kind.
    const issued = await challenge();
    const bad = await request.post('/api/auth/verify')
      .send({ signedEvent: loginEvent(issued, 1) });
    expect(bad.status).toBe(400);

    const good = await request.post('/api/auth/verify')
      .send({ signedEvent: loginEvent(issued, 27235) });
    expect(good.status).toBe(200);
  });
});
