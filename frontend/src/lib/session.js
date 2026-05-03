/**
 * Cross-subdomain session management for Cloistr
 *
 * Uses cookies on .cloistr.xyz domain to share auth state across all services.
 * This allows single sign-on: login once on any service, authenticated everywhere.
 */

/**
 * Session TTL options in seconds
 */
export const SESSION_TTL_OPTIONS = {
  '1d': 60 * 60 * 24,           // 1 day
  '7d': 60 * 60 * 24 * 7,       // 7 days
  '30d': 60 * 60 * 24 * 30,     // 30 days
  'never': 60 * 60 * 24 * 400,  // 400 days (browser max)
};

export const SESSION_TTL_LABELS = {
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
  'never': 'Does not expire',
};

const DEFAULT_TTL = '30d';

const COOKIE_KEYS = {
  METHOD: 'cloistr_auth_method',
  PUBKEY: 'cloistr_auth_pubkey',
  BUNKER: 'cloistr_auth_bunker',
  TTL: 'cloistr_session_ttl',
};

/**
 * Check if running on a cloistr.xyz domain
 */
export function isCloistrDomain() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.endsWith('cloistr.xyz') ||
         window.location.hostname === 'cloistr.xyz';
}

/**
 * Get a cookie by name
 */
function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Get current TTL preference or default
 */
export function getSessionTTL() {
  const stored = getCookie(COOKIE_KEYS.TTL);
  if (stored && stored in SESSION_TTL_OPTIONS) {
    return stored;
  }
  return DEFAULT_TTL;
}

/**
 * Build cookie string with specific maxAge
 */
function buildCookieWithMaxAge(name, value, maxAge) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (isCloistrDomain()) {
    parts.push('domain=.cloistr.xyz');
  }

  parts.push('path=/');
  parts.push(`max-age=${maxAge}`);
  parts.push('secure');
  parts.push('samesite=lax');

  return parts.join('; ');
}

/**
 * Build cookie string with user's TTL preference
 */
function buildCookie(name, value) {
  const ttl = getSessionTTL();
  const maxAge = SESSION_TTL_OPTIONS[ttl];
  return buildCookieWithMaxAge(name, value, maxAge);
}

/**
 * Set session TTL preference
 */
export function setSessionTTL(ttl) {
  if (typeof document === 'undefined') return;
  const maxAge = SESSION_TTL_OPTIONS[ttl];
  document.cookie = buildCookieWithMaxAge(COOKIE_KEYS.TTL, ttl, maxAge);

  // Refresh other session cookies with new TTL
  const session = getSharedSession();
  if (session) {
    saveSharedSession(session);
  }
}

/**
 * Save shared session to cookies
 */
export function saveSharedSession(session) {
  if (typeof document === 'undefined') return;

  document.cookie = buildCookie(COOKIE_KEYS.METHOD, session.method);
  document.cookie = buildCookie(COOKIE_KEYS.PUBKEY, session.pubkey);

  if (session.bunkerUrl) {
    document.cookie = buildCookie(COOKIE_KEYS.BUNKER, session.bunkerUrl);
  }
}

/**
 * Get shared session from cookies
 */
export function getSharedSession() {
  const method = getCookie(COOKIE_KEYS.METHOD);
  const pubkey = getCookie(COOKIE_KEYS.PUBKEY);

  if (!method || !pubkey) return null;

  return {
    method,
    pubkey,
    bunkerUrl: getCookie(COOKIE_KEYS.BUNKER) || undefined,
  };
}

/**
 * Check if a shared session exists
 */
export function hasSharedSession() {
  return !!getCookie(COOKIE_KEYS.PUBKEY);
}

/**
 * Clear shared session cookies
 */
export function clearSharedSession() {
  if (typeof document === 'undefined') return;

  const deleteCookie = (name) => {
    if (isCloistrDomain()) {
      document.cookie = `${name}=; domain=.cloistr.xyz; path=/; max-age=0`;
    }
    document.cookie = `${name}=; path=/; max-age=0`;
  };

  deleteCookie(COOKIE_KEYS.METHOD);
  deleteCookie(COOKIE_KEYS.PUBKEY);
  deleteCookie(COOKIE_KEYS.BUNKER);
  deleteCookie(COOKIE_KEYS.TTL);
}

/**
 * Renew session cookies with fresh TTL
 * Call this on token refresh for auto-renewal
 */
export function renewSession() {
  const session = getSharedSession();
  if (session) {
    saveSharedSession(session);
  }
}
