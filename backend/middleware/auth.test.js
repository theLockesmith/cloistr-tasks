/**
 * Tests for the JWT secret startup guard in middleware/auth.js.
 *
 * The guard calls process.exit(1) on bad input, so each failure case runs
 * in a child process. We assert the exit code and stderr output.
 *
 * The happy-path case (valid secret) imports auth.js in-process and
 * exercises issueJWT / verifyJWT round-trip.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Spawn `node -e <code>` with a controlled JWT_SECRET, stripping the
 * committed .env from the environment so dotenv.config() finds nothing.
 * Returns { code, stderr }.
 */
function spawnWithSecret(secret) {
  return new Promise((resolve) => {
    const env = { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' };
    if (secret === undefined) {
      delete env.JWT_SECRET;
    } else {
      env.JWT_SECRET = secret;
    }

    const script = `await import(${JSON.stringify(
      'file://' + path.resolve(__dirname, 'auth.js')
    )});`;

    // Run from /tmp so dotenv.config() finds no .env file (the committed
    // backend/.env would otherwise override our controlled environment).
    execFile('node', ['--input-type=module', '-e', script], { env, cwd: '/tmp' }, (err, _stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stderr });
    });
  });
}

// ── Startup guard ─────────────────────────────────────────────────────────

describe('JWT secret startup guard', () => {
  test('exits 1 when JWT_SECRET is not set', async () => {
    const { code, stderr } = await spawnWithSecret(undefined);
    expect(code).toBe(1);
    expect(stderr).toContain('FATAL: JWT_SECRET is not set');
  });

  test('exits 1 on committed fallback: cloistr-tasks-jwt-secret-change-in-production', async () => {
    const { code, stderr } = await spawnWithSecret(
      'cloistr-tasks-jwt-secret-change-in-production'
    );
    expect(code).toBe(1);
    expect(stderr).toContain('known placeholder');
  });

  test('exits 1 on committed .env value: cloistr-dev-secret-change-in-production', async () => {
    const { code, stderr } = await spawnWithSecret(
      'cloistr-dev-secret-change-in-production'
    );
    expect(code).toBe(1);
    expect(stderr).toContain('known placeholder');
  });

  test('loads successfully with a real secret', async () => {
    const { code, stderr } = await spawnWithSecret('a-valid-test-secret');
    expect(code).toBe(0);
    expect(stderr).not.toContain('FATAL');
  });
});

// ── JWT round-trip (in-process, requires a valid secret) ──────────────────

describe('issueJWT / verifyJWT round-trip', () => {
  let issueJWT, verifyJWT;

  beforeAll(async () => {
    // The top-level process already has JWT_SECRET set by the test runner
    // (see the npm test command or CI config).
    const mod = await import('./auth.js');
    issueJWT = mod.issueJWT;
    verifyJWT = mod.verifyJWT;
  });

  test('issued token verifies back to the same pubkey', () => {
    const pubkey = 'ab'.repeat(32);
    const { token } = issueJWT(pubkey);
    const decoded = verifyJWT(token);
    expect(decoded).not.toBeNull();
    expect(decoded.pubkey).toBe(pubkey);
  });

  test('tampered token returns null', () => {
    const { token } = issueJWT('cd'.repeat(32));
    const tampered = token.slice(0, -4) + 'XXXX';
    expect(verifyJWT(tampered)).toBeNull();
  });

  test('additional claims survive the round-trip', () => {
    const pubkey = 'ef'.repeat(32);
    const { token } = issueJWT(pubkey, { username: 'alice' });
    const decoded = verifyJWT(token);
    expect(decoded.username).toBe('alice');
  });
});
