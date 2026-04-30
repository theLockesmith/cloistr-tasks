/**
 * Cross-subdomain session management for Cloistr
 *
 * Uses cookies on .cloistr.xyz domain to share auth state across all services.
 * This allows single sign-on: login once on any service, authenticated everywhere.
 */

const COOKIE_CONFIG = {
  domain: '.cloistr.xyz',
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
  secure: true,
  sameSite: 'lax',
};

const COOKIE_KEYS = {
  METHOD: 'cloistr_auth_method',
  PUBKEY: 'cloistr_auth_pubkey',
  BUNKER: 'cloistr_auth_bunker',
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
 * Build cookie string with proper attributes
 */
function buildCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (isCloistrDomain()) {
    parts.push(`domain=${options.domain}`);
  }
  parts.push(`path=${options.path}`);
  parts.push(`max-age=${options.maxAge}`);
  if (options.secure) parts.push('secure');
  parts.push(`samesite=${options.sameSite}`);

  return parts.join('; ');
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
 * Save shared session to cookies
 */
export function saveSharedSession(session) {
  if (typeof document === 'undefined') return;

  document.cookie = buildCookie(COOKIE_KEYS.METHOD, session.method, COOKIE_CONFIG);
  document.cookie = buildCookie(COOKIE_KEYS.PUBKEY, session.pubkey, COOKIE_CONFIG);

  if (session.bunkerUrl) {
    document.cookie = buildCookie(COOKIE_KEYS.BUNKER, session.bunkerUrl, COOKIE_CONFIG);
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

  const expiredConfig = { ...COOKIE_CONFIG, maxAge: 0 };

  document.cookie = buildCookie(COOKIE_KEYS.METHOD, '', expiredConfig);
  document.cookie = buildCookie(COOKIE_KEYS.PUBKEY, '', expiredConfig);
  document.cookie = buildCookie(COOKIE_KEYS.BUNKER, '', expiredConfig);
}
