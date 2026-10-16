/**
 * NIP-98 HTTP Auth, for requests from other Cloistr apps.
 *
 * Another app (Space's Activity widget) calls tasks with the user's own
 * signer rather than holding a tasks JWT. The request carries
 *
 *   Authorization: Nostr <base64 of a signed kind-27235 event>
 *
 * and the event must name this exact request: tag `u` is the full URL
 * including the query string, tag `method` is the HTTP method. It must be
 * at most 60 seconds from now, and each event id is accepted once (recorded
 * in nip98_seen_events, so the guard holds across backend replicas).
 *
 * Deliberately wired onto ONE endpoint (GET /api/cards) via
 * authenticateTokenOrNip98. Every other endpoint stays JWT-only.
 */

import { verifyEvent } from 'nostr-tools/pure';
import { authenticateToken } from './auth.js';

export const NIP98_KIND = 27235;
export const NIP98_WINDOW_SECONDS = 60;

/**
 * The URL the client must have signed. APP_URL (the public origin, set per
 * environment in the configmap) is preferred over the Host header, because
 * TLS ends before the backend and the scheme it sees is not the one the
 * browser used.
 */
export function expectedRequestUrl(req) {
  const origin = (process.env.APP_URL || `https://${req.get('host')}`).replace(/\/+$/, '');
  return origin + req.originalUrl;
}

/** Decode the header. Returns the event object, or null if it is not one. */
export function parseNip98Header(header) {
  const m = /^Nostr\s+([A-Za-z0-9+/=_-]+)$/.exec(header || '');
  if (!m) return null;
  try {
    const event = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    return event && typeof event === 'object' ? event : null;
  } catch {
    return null;
  }
}

const tag = (event, name) => {
  const t = Array.isArray(event.tags) && event.tags.find(x => Array.isArray(x) && x[0] === name);
  return t ? t[1] : undefined;
};

/**
 * Check everything except replay. Returns the signer's pubkey, or a string
 * reason prefixed with "!" (kept out of responses; logged only).
 */
export function checkNip98Event(event, { url, method, now = Math.floor(Date.now() / 1000) }) {
  if (!event) return '!malformed';
  if (event.kind !== NIP98_KIND) return '!wrong kind';
  if (typeof event.created_at !== 'number' || Math.abs(now - event.created_at) > NIP98_WINDOW_SECONDS) {
    return '!stale';
  }
  if (tag(event, 'u') !== url) return '!wrong url';
  if (String(tag(event, 'method') || '').toUpperCase() !== method.toUpperCase()) return '!wrong method';
  let valid = false;
  try { valid = verifyEvent(event); } catch { valid = false; }
  if (!valid) return '!bad signature';
  return event.pubkey;
}

/**
 * Record the event id; false if it was already used. Expired rows are swept
 * on the way, so the table only ever holds about a minute of events.
 */
async function claimEventId(pool, id) {
  await pool.query(`DELETE FROM nip98_seen_events WHERE expires_at < NOW()`);
  const result = await pool.query(
    `INSERT INTO nip98_seen_events (event_id, expires_at)
     VALUES ($1, NOW() + make_interval(secs => $2))
     ON CONFLICT (event_id) DO NOTHING`,
    [id, NIP98_WINDOW_SECONDS * 2],
  );
  return result.rowCount === 1;
}

/**
 * Middleware: a `Nostr` Authorization header is checked as NIP-98, anything
 * else goes to the usual JWT check. getPool is a function because server.js
 * can swap its pool (tests do).
 */
export function authenticateTokenOrNip98(getPool) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    if (!/^Nostr\s/.test(header)) return authenticateToken(req, res, next);

    const event = parseNip98Header(header);
    const result = checkNip98Event(event, { url: expectedRequestUrl(req), method: req.method });
    if (result.startsWith('!')) {
      console.warn('NIP-98 rejected:', result.slice(1));
      return res.status(401).json({ error: 'Invalid NIP-98 authorization' });
    }
    try {
      if (!(await claimEventId(getPool(), event.id))) {
        console.warn('NIP-98 rejected: replayed event');
        return res.status(401).json({ error: 'Invalid NIP-98 authorization' });
      }
    } catch (error) {
      console.error('NIP-98 replay check failed:', error);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
    req.user = { id: result, pubkey: result, roles: [] };
    next();
  };
}
