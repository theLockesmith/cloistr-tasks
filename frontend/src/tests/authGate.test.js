/**
 * Regression tests for the AppContent render gate (src/lib/authGate.js).
 *
 * These exercise the REAL resolveAuthView the app renders from, not a copy.
 *
 * DEFECT UNDER TEST (production, 2026-08-28)
 * ─────────────────────────────────────────
 * Reported as: "it also failed auth once without any 'Signing you in securely'".
 *
 * SharedAuthProvider's AuthRestoreGate covers only the Nostr/SSO restore and
 * renders INSTEAD of its children. cloistr-tasks then exchanges that identity
 * for a backend JWT (AuthContext.attemptSignerAuth) — inside those children, so
 * only after the gate has released. Meanwhile loginWithSigner clears `loading`
 * in a finally on every failed attempt, while attemptSignerAuth waits 1500ms
 * then 4000ms between retries. Those gaps looked exactly like "settled, signed
 * out", so the sign-in screen rendered under an in-flight auth attempt.
 *
 * Verified against the deployed bundle (index-CogPiwIq.js) and the tasks-backend
 * and signer access logs; the backend returned 200 to every auth request in the
 * window. See src/lib/authGate.js for the annotated timeline.
 */

import { resolveAuthView } from '../lib/authGate';

/** Defaults: settled, signed out, no shared session. */
const base = {
  isAuthenticated: false,
  loading: false,
  initializing: false,
  isResolving: false,
  signerError: null,
  signerAuthPending: false,
  hasSharedSession: false,
  retrying: false,
};

const view = (over) => resolveAuthView({ ...base, ...over });

describe('resolveAuthView — the regression', () => {
  it('NEVER shows the login screen while an automatic signer auth is in flight', () => {
    // The exact state during attemptSignerAuth's 1500ms / 4000ms waits:
    // loading already cleared by loginWithSigner's finally, no error yet.
    expect(view({ signerAuthPending: true, hasSharedSession: true })).toBe('restore-gate');
  });

  it('holds the gate through the retry waits even with no shared-session cookie', () => {
    // hasSharedSession can be false while the exchange is genuinely running
    // (identity came from the signer, not the cookie). Must still not flash login.
    expect(view({ signerAuthPending: true, hasSharedSession: false })).toBe('restore-gate');
  });

  it('shows the gate, not a bare spinner, to a returning user still resolving', () => {
    expect(view({ isResolving: true, hasSharedSession: true })).toBe('restore-gate');
    expect(view({ loading: true, hasSharedSession: true })).toBe('restore-gate');
    expect(view({ initializing: true, hasSharedSession: true })).toBe('restore-gate');
  });
});

describe('resolveAuthView — states that must NOT be gated', () => {
  it('a genuinely signed-out visitor is never told they are being signed in', () => {
    // No shared session: a spinner is honest, "Signing you in securely" is a lie.
    expect(view({ loading: true, hasSharedSession: false })).toBe('loading');
    expect(view({ initializing: true, hasSharedSession: false })).toBe('loading');
  });

  it('settled and signed out lands on the login screen', () => {
    expect(view({})).toBe('login');
  });

  it('settled and signed in renders the app', () => {
    expect(view({ isAuthenticated: true })).toBe('app');
  });

  it('an authenticated user is never held behind the gate', () => {
    expect(view({ isAuthenticated: true, signerAuthPending: true })).toBe('app');
    expect(view({ isAuthenticated: true, hasSharedSession: true, loading: false })).toBe('app');
  });
});

describe('resolveAuthView — signer recovery is preserved', () => {
  it('a settled signing failure offers recovery, not a credential prompt', () => {
    expect(view({ signerError: new Error('HTTP 504') })).toBe('signer-recovery');
  });

  it('manual "Try again" keeps SignerRecovery and its in-place spinner', () => {
    // retrying=true must NOT swap to the full-screen gate.
    expect(
      view({ signerError: new Error('HTTP 504'), signerAuthPending: true, retrying: true }),
    ).toBe('signer-recovery');
  });

  it('"Go back" from recovery returns to the login screen', () => {
    // clearSignerError() clears both the error and the pending flag.
    expect(view({ signerError: null, signerAuthPending: false })).toBe('login');
  });
});

describe('resolveAuthView — replay of the production sequence', () => {
  /**
   * Replays attemptSignerAuth's control flow verbatim, sampling the view at each
   * transition. Asserts the login screen is never reachable mid-flight.
   *
   * Sequence mirrors 2026-08-28 01:12:43-01:12:57: attempt 1 fails (signer
   * session not yet connected), 1500ms wait, attempt 2 succeeds.
   */
  it('shows the gate continuously from first attempt to success', () => {
    const seen = [];
    let s = { ...base, hasSharedSession: true, signerAuthPending: true };
    const sample = () => seen.push(resolveAuthView(s));

    sample();                                    // attemptSignerAuth entered
    s = { ...s, loading: true };  sample();      // attempt 1 in loginWithSigner
    s = { ...s, loading: false }; sample();      // attempt 1 failed -> finally
    sample();                                    // ...the 1500ms wait
    s = { ...s, loading: true };  sample();      // attempt 2
    s = { ...s, loading: false, isAuthenticated: true, signerAuthPending: false };
    sample();                                    // success

    expect(seen).not.toContain('login');
    expect(seen.slice(0, -1).every((v) => v === 'restore-gate')).toBe(true);
    expect(seen[seen.length - 1]).toBe('app');
  });

  it('a persistent failure ends on recovery, never on the login screen', () => {
    const seen = [];
    let s = { ...base, hasSharedSession: true, signerAuthPending: true };
    const sample = () => seen.push(resolveAuthView(s));

    for (let attempt = 0; attempt < 3; attempt++) {
      s = { ...s, loading: true };  sample();
      s = { ...s, loading: false }; sample();   // the wait between retries
    }
    // Retries exhausted: setSignerError then the finally clears pending.
    s = { ...s, signerError: new Error('HTTP 504'), signerAuthPending: false };
    sample();

    expect(seen).not.toContain('login');
    expect(seen[seen.length - 1]).toBe('signer-recovery');
  });
});
