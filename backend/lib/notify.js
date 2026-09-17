/**
 * Browser push notifications for board activity.
 *
 * Called fire-and-forget from route handlers after the DB write that
 * triggered the notification has already succeeded (same pattern as
 * logActivity() in server.js) — a notification failure must never fail
 * the request that caused it.
 */

import webpush from 'web-push';

// web-push holds VAPID config at module scope. Configure lazily on first
// use rather than at import time, so tests that never set the env vars
// don't need to stub them, and a deployment without VAPID keys degrades
// gracefully instead of throwing on startup.
let vapidState = null; // true = configured, false = not configured (env vars missing)

function ensureConfigured() {
  if (vapidState !== null) return vapidState;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    vapidState = false;
    return vapidState;
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:notifications@cloistr.xyz',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
  vapidState = true;
  return vapidState;
}

// Test-only: allow a fresh module under test to re-evaluate env vars set
// after import (jest's ESM module registry is otherwise a singleton).
export function _resetVapidStateForTests() {
  vapidState = null;
}

/**
 * Notify every other contributor on a board that something happened.
 *
 * Recipients are every pubkey with a share on the list (task_list_shares)
 * plus the list owner (task_lists.user_id), minus the actor who triggered
 * the notification. Each recipient's push_subscriptions rows all get the
 * same small payload.
 *
 * Never throws — callers use this fire-and-forget (`.catch(...)`), but the
 * function is defensive on its own so a bug here can never surface as a
 * 500 on the board endpoint that called it.
 *
 * @param {import('pg').Pool} pool
 * @param {number|string} listId
 * @param {string} actorPubkey - the pubkey who triggered the event; excluded from recipients
 * @param {string} title
 * @param {string} body
 */
export async function notifyBoardContributors(pool, listId, actorPubkey, title, body) {
  try {
    if (!ensureConfigured()) return;

    const recipientsResult = await pool.query(`
      SELECT pubkey FROM task_list_shares WHERE list_id = $1
      UNION
      SELECT user_id AS pubkey FROM task_lists WHERE id = $1
    `, [listId]);

    const recipients = recipientsResult.rows
      .map((row) => row.pubkey)
      .filter((pubkey) => pubkey && pubkey !== actorPubkey);

    if (recipients.length === 0) return;

    const subsResult = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_pubkey = ANY($1)',
      [recipients],
    );

    if (subsResult.rows.length === 0) return;

    // Keep the payload small (title/body/url only) — push services cap
    // message size, and a fat payload is unnecessary for a notification.
    const payload = JSON.stringify({ title, body, url: `/boards/${listId}` });

    await Promise.all(subsResult.rows.map((sub) => sendOne(pool, sub, payload)));
  } catch (error) {
    console.error('notifyBoardContributors error:', error);
  }
}

async function sendOne(pool, sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    );
  } catch (error) {
    // 404/410 means the push service has permanently invalidated this
    // subscription (browser uninstalled, permission revoked, etc.) —
    // clean it up so future notifications don't keep retrying it.
    if (error.statusCode === 404 || error.statusCode === 410) {
      await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch((delError) => {
        console.error('Failed to delete stale push subscription:', delError);
      });
    } else {
      console.error('Push send failed:', error.message || error);
    }
  }
}
