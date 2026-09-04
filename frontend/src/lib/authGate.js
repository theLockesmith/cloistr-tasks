// frontend/src/lib/authGate.js
/**
 * The single decision for "what does AppContent render right now".
 *
 * Extracted from App.js so it is directly testable. This app has no jsdom
 * environment (see src/tests/signerResilience.test.js), so branching that stays
 * inline in JSX cannot be covered by a test — and this particular branching is
 * exactly where a production auth defect lived, so it needs coverage.
 *
 * BACKGROUND
 *
 * SharedAuthProvider renders its "Signing you in securely" gate (AuthRestoreGate)
 * INSTEAD of its children while the Nostr/SSO restore is in flight. cloistr-tasks
 * then does a SECOND exchange — trading that restored identity for a backend JWT
 * (AuthContext.attemptSignerAuth). That exchange necessarily runs inside the
 * children, i.e. only AFTER the shared gate has released. So the shared gate can
 * never be on screen while the JWT exchange runs, and every failure of it was, by
 * construction, a failure with no gate shown.
 *
 * Compounding it: loginWithSigner clears `loading` in a finally on every failed
 * attempt, while attemptSignerAuth waits 1500ms and then 4000ms between retries.
 * In those gaps loading=false, signerError=null, isAuthenticated=false — which is
 * indistinguishable from "settled, signed out" — so the sign-in screen rendered
 * underneath an auth attempt that was still in flight.
 *
 * Observed in production on 2026-08-28 (tasks-backend + signer access logs):
 *   01:12:33  page load
 *   01:12:42  user reloads — having been shown the sign-in screen
 *   01:12:43  GET /api/auth/challenge 200   <- attempt 1
 *   01:12:44  nostrconnect signer session finally connects (771ms handshake)
 *   01:12:45  GET /api/auth/challenge 200   <- attempt 2, after the 1500ms wait
 *   01:12:57  POST /api/auth/verify 200     <- success
 * The backend returned 200 to every auth request in the whole window; nothing
 * failed server-side. The defect was purely what the user was shown meanwhile.
 *
 * @returns {'restore-gate'|'loading'|'signer-recovery'|'app'|'login'}
 */
export function resolveAuthView({
  isAuthenticated,
  loading,
  initializing,
  isResolving,
  signerError,
  signerAuthPending,
  hasSharedSession,
  retrying,
}) {
  // An automatic signer->JWT exchange is in flight, INCLUDING the waits between
  // its retries. Must be checked before the `loading` gate, because `loading` is
  // false during exactly those waits.
  //
  // `retrying` excludes the manual "Try again" on SignerRecovery, which keeps its
  // own in-place spinner rather than swapping to a full-screen gate.
  if (!isAuthenticated && signerAuthPending && !retrying) {
    return 'restore-gate';
  }

  if (loading || initializing || isResolving) {
    // A returning user with a shared session gets the suite-wide affordance.
    // A genuinely signed-out visitor must NOT be told they are being signed in.
    return hasSharedSession && !isAuthenticated ? 'restore-gate' : 'loading';
  }

  // A settled signing failure. The Nostr session is still valid — this is a
  // signing/backend failure, so offer recovery rather than a credential prompt.
  if (signerError) {
    return 'signer-recovery';
  }

  return isAuthenticated ? 'app' : 'login';
}
