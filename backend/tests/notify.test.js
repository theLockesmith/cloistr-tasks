/**
 * Unit tests for backend/lib/notify.js against a mocked 'web-push' module
 * and a fake pg Pool (jest.fn() query spies). No DB or network required —
 * this exercises the actual recipient-resolution and delivery/cleanup logic
 * in isolation.
 *
 * ESM mocking: 'web-push' is mocked with jest.unstable_mockModule BEFORE
 * notify.js is dynamically imported, matching the project's ESM test setup
 * (jest --experimental-vm-modules, "type": "module").
 */

import { jest } from '@jest/globals';

const sendNotification = jest.fn();
const setVapidDetails = jest.fn();

jest.unstable_mockModule('web-push', () => ({
  default: { sendNotification, setVapidDetails },
}));

// Imported after the mock is registered so notify.js picks up the mock.
const { notifyBoardContributors, _resetVapidStateForTests } = await import('../lib/notify.js');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  _resetVapidStateForTests();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('notifyBoardContributors — not configured (graceful degradation)', () => {
  test('no-ops when VAPID keys are absent: never queries the pool or sends', async () => {
    const pool = makePool();
    await notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body');

    expect(pool.query).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('does not throw', async () => {
    const pool = makePool();
    await expect(notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body')).resolves.toBeUndefined();
  });
});

describe('notifyBoardContributors — configured', () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
  });

  test('configures web-push with VAPID details on first use', async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes('task_list_shares')) return { rows: [] };
      return { rows: [] };
    });

    await notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body');
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:notifications@cloistr.xyz',
      'pub',
      'priv',
    );
  });

  test('uses VAPID_SUBJECT when set', async () => {
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
    const pool = makePool(async () => ({ rows: [] }));

    await notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body');
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:ops@example.com', 'pub', 'priv');
  });

  test('excludes the actor from recipients and queries subscriptions for the rest', async () => {
    const pool = makePool(async (sql, params) => {
      if (sql.includes('task_list_shares')) {
        return { rows: [{ pubkey: 'actor' }, { pubkey: 'bob' }, { pubkey: 'carol' }] };
      }
      if (sql.includes('SELECT id, endpoint, p256dh, auth FROM push_subscriptions')) {
        // Actor must not be in the recipient list passed to this query.
        expect(params[0]).toEqual(expect.arrayContaining(['bob', 'carol']));
        expect(params[0]).not.toContain('actor');
        return { rows: [] };
      }
      return { rows: [] };
    });

    await notifyBoardContributors(pool, 42, 'actor', 'Title', 'Body');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('short-circuits (no subscription lookup) when every share-holder is the actor', async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes('task_list_shares')) return { rows: [{ pubkey: 'actor' }] };
      return { rows: [] };
    });

    await notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body');
    expect(pool.query).toHaveBeenCalledTimes(1); // only the recipients query
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('sends a small {title, body, url} payload to each subscription', async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes('task_list_shares')) return { rows: [{ pubkey: 'bob' }] };
      if (sql.includes('push_subscriptions')) {
        return { rows: [{ id: 1, endpoint: 'https://push.example/ep1', p256dh: 'p1', auth: 'a1' }] };
      }
      return { rows: [] };
    });
    sendNotification.mockResolvedValueOnce({});

    await notifyBoardContributors(pool, 7, 'actor', 'New card', 'Something happened');

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [subscription, payload] = sendNotification.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: 'https://push.example/ep1',
      keys: { p256dh: 'p1', auth: 'a1' },
    });
    expect(JSON.parse(payload)).toEqual({
      title: 'New card',
      body: 'Something happened',
      url: '/boards/7',
    });
  });

  test('fans out to multiple subscriptions', async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes('task_list_shares')) return { rows: [{ pubkey: 'bob' }, { pubkey: 'carol' }] };
      if (sql.includes('push_subscriptions')) {
        return {
          rows: [
            { id: 1, endpoint: 'https://push.example/ep1', p256dh: 'p1', auth: 'a1' },
            { id: 2, endpoint: 'https://push.example/ep2', p256dh: 'p2', auth: 'a2' },
          ],
        };
      }
      return { rows: [] };
    });
    sendNotification.mockResolvedValue({});

    await notifyBoardContributors(pool, 7, 'actor', 'Title', 'Body');
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  test('deletes the subscription when the push service returns 410 (gone)', async () => {
    const deleteCalls = [];
    const pool = makePool(async (sql, params) => {
      if (sql.includes('task_list_shares')) return { rows: [{ pubkey: 'bob' }] };
      if (sql.includes('SELECT id, endpoint')) {
        return { rows: [{ id: 99, endpoint: 'https://push.example/dead', p256dh: 'p', auth: 'a' }] };
      }
      if (sql.includes('DELETE FROM push_subscriptions')) {
        deleteCalls.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    });
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });

    await notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body');

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toEqual([99]);
  });

  test('deletes the subscription when the push service returns 404 (not found)', async () => {
    const deleteCalls = [];
    const pool = makePool(async (sql, params) => {
      if (sql.includes('task_list_shares')) return { rows: [{ pubkey: 'bob' }] };
      if (sql.includes('SELECT id, endpoint')) {
        return { rows: [{ id: 5, endpoint: 'https://push.example/dead', p256dh: 'p', auth: 'a' }] };
      }
      if (sql.includes('DELETE FROM push_subscriptions')) {
        deleteCalls.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    });
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });

    await notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body');
    expect(deleteCalls).toEqual([[5]]);
  });

  test('does NOT delete the subscription on a transient error (e.g. 500)', async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes('task_list_shares')) return { rows: [{ pubkey: 'bob' }] };
      if (sql.includes('SELECT id, endpoint')) {
        return { rows: [{ id: 5, endpoint: 'https://push.example/flaky', p256dh: 'p', auth: 'a' }] };
      }
      return { rows: [] };
    });
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });

    await notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body');

    const deleteCall = pool.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM push_subscriptions'));
    expect(deleteCall).toBeUndefined();
  });

  test('one failing subscription does not stop delivery to the others', async () => {
    const pool = makePool(async (sql) => {
      if (sql.includes('task_list_shares')) return { rows: [{ pubkey: 'bob' }, { pubkey: 'carol' }] };
      if (sql.includes('SELECT id, endpoint')) {
        return {
          rows: [
            { id: 1, endpoint: 'https://push.example/ep1', p256dh: 'p1', auth: 'a1' },
            { id: 2, endpoint: 'https://push.example/ep2', p256dh: 'p2', auth: 'a2' },
          ],
        };
      }
      return { rows: [] };
    });
    sendNotification
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValueOnce({});

    await expect(notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body')).resolves.toBeUndefined();
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  test('never throws even if the pool rejects', async () => {
    const pool = makePool(async () => { throw new Error('DB unreachable'); });
    await expect(notifyBoardContributors(pool, 1, 'actor', 'Title', 'Body')).resolves.toBeUndefined();
  });
});
