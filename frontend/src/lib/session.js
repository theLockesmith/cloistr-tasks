/**
 * Cross-subdomain session management for Cloistr
 *
 * Uses cookies on the environment's parent domain (.cloistr.xyz in production)
 * to share auth state across all services. This allows single sign-on: login
 * once on any service, authenticated everywhere.
 *
 * Sessions must not cross environments (staging-environment.md, rule 4).
 * Staging hosts sit inside .cloistr.xyz, so scoping alone is not enough: the
 * browser still sends production's .cloistr.xyz cookies to a staging host. So
 * outside production the cookies are BOTH scoped to the staging parent domain
 * AND named per environment, and staging never reads production's names.
 * Production keeps the original domain and names.
 */

import { serviceConfig } from './serviceConfig';

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

/**
 * Cookie name prefix for this environment: 'cloistr_' in production (the
 * original names), 'cloistr_<env>_' anywhere else.
 */
function cookiePrefix() {
  const env = String(serviceConfig.environment || 'production').toLowerCase().replace(/[^a-z0-9]/g, '');
  return env === 'production' || env === '' ? 'cloistr_' : `cloistr_${env}_`;
}

const COOKIE_KEYS = {
  METHOD: `${cookiePrefix()}auth_method`,
  PUBKEY: `${cookiePrefix()}auth_pubkey`,
  BUNKER: `${cookiePrefix()}auth_bunker`,
  TTL: `${cookiePrefix()}session_ttl`,
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
 * The domain to scope session cookies to, or null for a host-only cookie.
 *
 * With a runtime appUrl (every deployed image), it is the app host's parent:
 * tasks.cloistr.xyz -> .cloistr.xyz, tasks.staging.cloistr.xyz ->
 * .staging.cloistr.xyz. Only applied when the page is actually served under
 * that parent; a mismatch (e.g. a staging image opened on localhost) falls
 * back to host-only rather than guessing. Without an appUrl (vite dev) the
 * original .cloistr.xyz rule applies.
 */
export function getCookieDomain() {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;

  if (serviceConfig.appUrl) {
    try {
      const labels = new URL(serviceConfig.appUrl).hostname.split('.');
      if (labels.length > 2) {
        const parent = labels.slice(1).join('.');
        if (host === parent || host.endsWith(`.${parent}`)) return `.${parent}`;
      }
    } catch {
      // A malformed appUrl is already reported by the config reader.
    }
    return null;
  }

  return isCloistrDomain() ? '.cloistr.xyz' : null;
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

  const domain = getCookieDomain();
  if (domain) {
    parts.push(`domain=${domain}`);
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
    const domain = getCookieDomain();
    if (domain) {
      document.cookie = `${name}=; domain=${domain}; path=/; max-age=0`;
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
