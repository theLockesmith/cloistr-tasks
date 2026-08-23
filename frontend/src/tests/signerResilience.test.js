/**
 * Tests for signer-resilience behaviour in cloistr-tasks.
 *
 * DOM ENVIRONMENT NOTE
 * ────────────────────
 * This app does NOT have a jsdom environment configured (vite.config.mjs has
 * no `test.environment: 'jsdom'` and @testing-library/react is not wired into
 * the test runner). React component tests (SignerRecovery rendering,
 * AppContent branching) therefore cannot be executed behaviourally here.
 *
 * Assertions in this file are SOURCE-LEVEL where no DOM is available. A
 * full code-path trace is provided so a reviewer can follow the logic without
 * running it. Pure-function tests (withSignerRetry, classifySignerError) are
 * executed directly.
 *
 * CODE PATH TRACE: signer failure during SSO restore
 * ───────────────────────────────────────────────────
 *  1. SharedAuthProvider completes the NIP-46 restore. authState.activePubkey
 *     is set; the @cloistr/auth AuthProvider emits an updated authState.
 *
 *  2. AuthContext.js effect (line ~451) fires with newPubkey set and activeSigner
 *     non-null. The JWT in localStorage is absent (fresh restore), so the
 *     `jwtIsUsable` check fails and `attemptSignerAuth()` is called.
 *
 *  3. attemptSignerAuth() (AuthContext.js) calls loginWithSigner(signer). Inside
 *     loginWithSigner, `signer.signEvent()` is now wrapped with withSignerRetry:
 *
 *       const signedEvent = await withSignerRetry(() => signer.signEvent(unsignedEvent));
 *
 *     withSignerRetry retries up to 3 times (300ms / 600ms / 4000ms jittered)
 *     for errors classified as 'retryable' (NO_RELAYS, CONNECTION_FAILED,
 *     DISCONNECTED). A denial (CANCELLED, REMOTE_ERROR) is rethrown immediately.
 *
 *  4a. If signing succeeds → loginWithSigner stores the JWT, sets user/token
 *      state. isAuthenticated() returns true. AppContent renders AuthenticatedApp.
 *      signerError stays null.
 *
 *  4b. If signing fails after retries (or immediately for a denial):
 *      - loginWithSigner rethrows the error.
 *      - attemptSignerAuth's loop re-checks err.transient / err.name. If the
 *        error is non-retryable (e.g., CANCELLED), the loop breaks immediately.
 *        If it is a 504/network error (transient=true or TypeError), it retries
 *        up to three times with delays [0, 1500, 4000]ms.
 *      - After exhausting retries, attemptSignerAuth calls setSignerError(lastError)
 *        and resets activePubkeyRef.current = null.
 *
 *  5. AppContent.js reads signerError from useAuth(). Because signerError is
 *     set (non-null), it renders <SignerRecovery> instead of <LoginScreen>.
 *     The Nostr session in SharedAuthProvider is UNTOUCHED. No clearAuth() was
 *     called. No credential prompt appears.
 *
 *  6. User clicks "Try again" → handleRetry() in AppContent calls
 *     retrySignerAuth() (= attemptSignerAuth). The flow from step 3 repeats.
 *     If it succeeds this time, signerError is set to null and AuthenticatedApp
 *     renders.
 *
 *  7. User clicks "Go back" → clearSignerError() sets signerError to null.
 *     AppContent falls through to the isAuthenticated() check, which is false
 *     (no JWT was obtained), so LoginScreen renders. The Nostr session in
 *     SharedAuthProvider is still intact.
 *
 * CODE PATH TRACE: visibilitychange reconnect
 * ────────────────────────────────────────────
 *  RelayReconnectMount (App.js) renders null but calls useRelayReconnect().
 *  The hook (src/lib/useRelayReconnect.js) registers:
 *    document.addEventListener('visibilitychange', onVisibilityChange)
 *    window.addEventListener('online', onOnline)
 *
 *  When the page becomes visible (document.visibilityState === 'visible'),
 *  scheduleReconnect() fires after 300ms. It reads authStateRef.current and
 *  signerRef.current. If method === 'nip46' and isConnected, it calls
 *  signer.getPublicKey() to warm up the relay WebSocket. Failure is swallowed.
 *  Session state is never modified.
 */

import { withSignerRetry, classifySignerError, isRetryableSignerError } from '@cloistr/ui';

// ── classifySignerError ───────────────────────────────────────────────────

describe('classifySignerError', () => {
  test('NO_RELAYS is retryable', () => {
    expect(classifySignerError({ code: 'NO_RELAYS' })).toBe('retryable');
  });

  test('CONNECTION_FAILED is retryable', () => {
    expect(classifySignerError({ code: 'CONNECTION_FAILED' })).toBe('retryable');
  });

  test('DISCONNECTED is retryable', () => {
    expect(classifySignerError({ code: 'DISCONNECTED' })).toBe('retryable');
  });

  test('TIMEOUT needs-user (must not auto-retry)', () => {
    expect(classifySignerError({ code: 'TIMEOUT' })).toBe('needs-user');
  });

  test('CANCELLED is terminal (user said no — never retry)', () => {
    expect(classifySignerError({ code: 'CANCELLED' })).toBe('terminal');
  });

  test('REMOTE_ERROR is terminal', () => {
    expect(classifySignerError({ code: 'REMOTE_ERROR' })).toBe('terminal');
  });

  test('unknown code is terminal (fail closed, not open)', () => {
    expect(classifySignerError({ code: 'SOMETHING_ELSE' })).toBe('terminal');
  });

  test('non-object error is terminal', () => {
    expect(classifySignerError('string error')).toBe('terminal');
  });

  test('null is terminal', () => {
    expect(classifySignerError(null)).toBe('terminal');
  });
});

// ── isRetryableSignerError ────────────────────────────────────────────────

describe('isRetryableSignerError', () => {
  test('true for NO_RELAYS', () => {
    expect(isRetryableSignerError({ code: 'NO_RELAYS' })).toBe(true);
  });

  test('false for CANCELLED', () => {
    expect(isRetryableSignerError({ code: 'CANCELLED' })).toBe(false);
  });

  test('false for TIMEOUT (needs user, not auto-retryable)', () => {
    expect(isRetryableSignerError({ code: 'TIMEOUT' })).toBe(false);
  });
});

// ── withSignerRetry — retryable errors ───────────────────────────────────

describe('withSignerRetry retries retryable failures', () => {
  test('succeeds on second attempt after a retryable error', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) {
        const err = new Error('relay gone');
        err.code = 'NO_RELAYS';
        throw err;
      }
      return 'signed';
    };

    const result = await withSignerRetry(fn, {
      attempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      sleep: () => Promise.resolve(),
      random: () => 0,
    });

    expect(result).toBe('signed');
    expect(calls).toBe(2);
  });

  test('throws after exhausting attempts', async () => {
    const err = Object.assign(new Error('no relays'), { code: 'NO_RELAYS' });
    const fn = async () => { throw err; };

    await expect(
      withSignerRetry(fn, {
        attempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        sleep: () => Promise.resolve(),
        random: () => 0,
      })
    ).rejects.toBe(err);
  });
});

// ── withSignerRetry — terminal errors must NOT be retried ─────────────────

describe('withSignerRetry does NOT retry terminal errors', () => {
  test('CANCELLED is rethrown immediately, fn called exactly once', async () => {
    let calls = 0;
    const err = Object.assign(new Error('declined'), { code: 'CANCELLED' });
    const fn = async () => {
      calls++;
      throw err;
    };

    await expect(
      withSignerRetry(fn, {
        attempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
        sleep: () => Promise.resolve(),
        random: () => 0,
      })
    ).rejects.toBe(err);

    // Critical: the signer was called exactly once. Retrying a refusal would
    // re-prompt the user for something they already declined.
    expect(calls).toBe(1);
  });

  test('REMOTE_ERROR is rethrown immediately', async () => {
    let calls = 0;
    const err = Object.assign(new Error('remote error'), { code: 'REMOTE_ERROR' });
    const fn = async () => {
      calls++;
      throw err;
    };

    await expect(
      withSignerRetry(fn, { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, sleep: () => Promise.resolve(), random: () => 0 })
    ).rejects.toBe(err);

    expect(calls).toBe(1);
  });
});

// ── withSignerRetry — TIMEOUT is passed through without auto-retry ────────

describe('withSignerRetry does NOT auto-retry TIMEOUT', () => {
  test('TIMEOUT is not retryable — rethrown immediately', async () => {
    let calls = 0;
    const err = Object.assign(new Error('timeout'), { code: 'TIMEOUT' });
    const fn = async () => {
      calls++;
      throw err;
    };

    await expect(
      withSignerRetry(fn, { attempts: 3, baseDelayMs: 0, maxDelayMs: 0, sleep: () => Promise.resolve(), random: () => 0 })
    ).rejects.toBe(err);

    expect(calls).toBe(1);
  });
});
