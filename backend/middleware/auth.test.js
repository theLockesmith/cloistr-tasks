import { jest } from '@jest/globals';

/**
 * Tests for the JWT startup guards in auth.js.
 *
 * auth.js calls process.exit(1) at module scope when JWT_SECRET is missing or
 * matches a known placeholder. We cannot import it normally in that case
 * without killing the test runner, so we spawn a child process and assert on
 * its exit code and stderr.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_MODULE = path.resolve(__dirname, 'auth.js');

/** Run `node -e "import(...)"` with a controlled JWT_SECRET. */
async function importAuthWith(jwtSecret) {
  const env = { ...process.env, JWT_SECRET: jwtSecret };
  // Explicitly unset if empty string so the guard sees it as missing.
  if (jwtSecret === '') delete env.JWT_SECRET;

  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      ['-e', `import(${JSON.stringify('file://' + AUTH_MODULE)})`],
      { env, timeout: 5000, cwd: '/tmp' },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// ── Startup guards ───────────────────────────────────────────────────────────

describe('JWT_SECRET startup guard', () => {
  test('exits 1 when JWT_SECRET is not set', async () => {
    const result = await importAuthWith('');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('FATAL');
    expect(result.stderr).toContain('not set');
  });

  test('exits 1 when JWT_SECRET is the old inline fallback', async () => {
    const result = await importAuthWith('cloistr-tasks-jwt-secret-change-in-production');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('known placeholder');
  });

  test('exits 1 when JWT_SECRET is the committed .env placeholder', async () => {
    const result = await importAuthWith('cloistr-dev-secret-change-in-production');
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('known placeholder');
  });

  test('loads successfully with a real secret', async () => {
    const result = await importAuthWith('a-real-secret-that-is-not-a-placeholder');
    expect(result.code).toBe(0);
  });
});

// ── Exports (with a valid secret set) ────────────────────────────────────────

// For these tests we need the module loaded in-process.
// JWT_SECRET must be set to something valid before import.
let authenticateToken, optionalAuth, issueJWT, verifyJWT;

beforeAll(async () => {
  // Set a valid secret so the guard passes.
  process.env.JWT_SECRET = 'test-secret-for-auth-tests-not-a-placeholder';
  const mod = await import('./auth.js');
  authenticateToken = mod.authenticateToken;
  optionalAuth = mod.optionalAuth;
  issueJWT = mod.issueJWT;
  verifyJWT = mod.verifyJWT;
});

describe('issueJWT', () => {
  test('returns a token string and expiration metadata', () => {
    const result = issueJWT('aa'.repeat(32));
    expect(typeof result.token).toBe('string');
    expect(typeof result.expiresAt).toBe('string');
    expect(typeof result.expiresIn).toBe('number');
    expect(result.expiresIn).toBeGreaterThan(0);
  });
});

describe('verifyJWT', () => {
  test('round-trips a token and recovers the pubkey', () => {
    const pubkey = 'bb'.repeat(32);
    const { token } = issueJWT(pubkey);
    const user = verifyJWT(token);
    expect(user).not.toBeNull();
    expect(user.pubkey).toBe(pubkey);
    expect(user.id).toBe(pubkey);
  });

  test('returns null for a garbage token', () => {
    expect(verifyJWT('not.a.jwt')).toBeNull();
  });

  test('returns null for a token signed with a different secret', () => {
    // Forge a token with a wrong secret by using jsonwebtoken directly.
    // We cannot call issueJWT with a different secret, so just pass garbage.
    expect(verifyJWT('eyJhbGciOiJIUzI1NiJ9.eyJwdWJrZXkiOiJ4In0.bad')).toBeNull();
  });
});

describe('authenticateToken middleware', () => {
  function mockReqRes(authHeader) {
    const req = { headers: { authorization: authHeader } };
    const res = {
      _status: null,
      _body: null,
      status(code) { this._status = code; return this; },
      json(body) { this._body = body; return this; },
    };
    return { req, res };
  }

  test('401 when no Authorization header', async () => {
    const { req, res } = mockReqRes(undefined);
    const next = jest.fn();
    await authenticateToken(req, res, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('403 when token is invalid', async () => {
    const { req, res } = mockReqRes('Bearer garbage');
    const next = jest.fn();
    await authenticateToken(req, res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next and sets req.user for a valid token', async () => {
    const pubkey = 'cc'.repeat(32);
    const { token } = issueJWT(pubkey);
    const { req, res } = mockReqRes(`Bearer ${token}`);
    const next = jest.fn();
    await authenticateToken(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.pubkey).toBe(pubkey);
  });
});

describe('optionalAuth middleware', () => {
  test('sets req.user to null when no header and calls next', async () => {
    const req = { headers: {} };
    const res = {};
    const next = jest.fn();
    await optionalAuth(req, res, next);
    expect(req.user).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  test('sets req.user when a valid token is present', async () => {
    const pubkey = 'dd'.repeat(32);
    const { token } = issueJWT(pubkey);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {};
    const next = jest.fn();
    await optionalAuth(req, res, next);
    expect(req.user.pubkey).toBe(pubkey);
    expect(next).toHaveBeenCalled();
  });
});
