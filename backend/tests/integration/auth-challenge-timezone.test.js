/**
 * A login challenge must not look expired because of the server's time zone.
 *
 * auth_challenges.expires_at is TIMESTAMP without time zone and is checked
 * against NOW(). When the expiry was a JS Date, node-postgres sent it in the
 * process's local zone, so on a host west of UTC every fresh challenge was
 * stored hours in the past and sign-in answered 401. Production runs UTC,
 * which hid it; this file pins a western zone so the bug shows anywhere.
 *
 * The zone comes from tests/global-timezone.js (Jest globalSetup); the
 * first test fails if it is not in force.
 */

import supertest from 'supertest';

import './setup.js';

import { initializeDatabase, createPool } from '../../database/init.js';
import { app, setPool } from '../../server.js';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

let pool, request;

beforeAll(async () => {
  await initializeDatabase();
  pool = createPool(process.env.DB_NAME);
  setPool(pool);
  request = supertest(app);
}, 30_000);

afterAll(async () => {
  if (pool) await pool.end();
});

describe('login challenge expiry on a server west of UTC', () => {
  test('the zone is really pinned (guards the test itself)', () => {
    // New York is never UTC: offset is 240 (EDT) or 300 (EST) minutes.
    expect([240, 300]).toContain(new Date().getTimezoneOffset());
  });

  test('a fresh challenge is stored about five minutes ahead of NOW()', async () => {
    const issued = (await request.get('/api/auth/challenge')).body;
    const row = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) AS ahead
         FROM auth_challenges WHERE challenge = $1`, [issued.challenge]);
    const ahead = Number(row.rows[0].ahead);
    expect(ahead).toBeGreaterThan(4 * 60);
    expect(ahead).toBeLessThanOrEqual(5 * 60 + 5);
  });

  test('a fresh challenge signs in', async () => {
    const sk = generateSecretKey();
    const issued = (await request.get('/api/auth/challenge')).body;
    const signedEvent = finalizeEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['challenge', issued.challenge], ['nonce', issued.nonce]],
      content: JSON.stringify({ challenge: issued.challenge, nonce: issued.nonce }),
    }, sk);
    const res = await request.post('/api/auth/verify').send({ signedEvent });
    expect(res.status).toBe(200);
    expect(res.body.user.pubkey).toBe(getPublicKey(sk));
  });
});
