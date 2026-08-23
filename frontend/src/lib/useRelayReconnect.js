/**
 * useRelayReconnect - Part 4 of the signer-resilience design.
 *
 * WHY THIS EXISTS
 *
 * Parts 1-3 (withSignerRetry, SignerRecovery) handle signing failures after
 * they occur. This hook prevents a class of failures from happening at all.
 *
 * When the OS backgrounds the browser (file picker, screen lock, app-switcher)
 * it kills WebSocket connections. On resume, the next signing operation hits
 * dead sockets and surfaces as a signer error. This hook reconnects the relay
 * sockets the moment the page becomes visible again, before the user acts.
 *
 * The 'online' event is also handled: a device regaining a network interface
 * after going offline triggers the same reconnect path.
 *
 * WHY DEBOUNCE
 *
 * A file-picker or screen-lock/unlock sequence fires visibilitychange several
 * times in rapid succession. Without debounce, each flip would open a new
 * relay connection attempt. Full jitter in withSignerRetry spreads app-level
 * retries; debounce here collapses multiple rapid events from the SAME tab
 * into one reconnect attempt.
 *
 * WHY NIP-46 ONLY
 *
 * NIP-07 (browser extension) signers do not hold persistent WebSockets that
 * this code controls. Only NIP-46 signers use relay WebSockets the OS can
 * kill on backgrounding.
 *
 * SESSION STATE IS NEVER TOUCHED
 *
 * This hook never calls clearAuth, logout, or any session-clearing function.
 * A reconnect hook that clears auth reintroduces the exact bug the
 * signer-resilience design exists to fix.
 *
 * NOTE: @cloistr/ui 0.27.0 will export useRelayReconnect from the package.
 * Once that version is published to the registry, this file should be deleted
 * and the import in App.js changed to '@cloistr/ui'.
 */

import { useEffect, useRef } from 'react';
import { useNostrAuth } from '@cloistr/auth';

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Reconnects relay WebSocket connections on visibilitychange (page becomes
 * visible) and on the browser 'online' event.
 *
 * Must be called inside an @cloistr/auth AuthProvider tree. SharedAuthProvider
 * satisfies that requirement.
 *
 * @param {object} [options]
 * @param {number} [options.debounceMs=300] Debounce window in ms.
 */
export function useRelayReconnect({ debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  const { authState, signer } = useNostrAuth();

  // Keep refs so event handlers always read the current value without being
  // torn down and re-added on every auth state change.
  const authStateRef = useRef(authState);
  const signerRef = useRef(signer);
  const timerRef = useRef(null);

  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  useEffect(() => {
    signerRef.current = signer;
  }, [signer]);

  useEffect(() => {
    const scheduleReconnect = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;

        const state = authStateRef.current;
        const currentSigner = signerRef.current;

        // Only warm up NIP-46 sessions. NIP-07 extensions manage their own
        // sockets. Sessions that were never established have nothing to warm.
        if (!state.isConnected || state.method !== 'nip46' || currentSigner === null) {
          return;
        }

        // getPublicKey exercises the Nip46Signer lazy-connect path, which
        // calls connect() internally when WebSockets are dead. The result is
        // discarded — this is a warm-up. Failure is swallowed here; parts 1-3
        // apply if the user then performs an action that requires signing.
        currentSigner.getPublicKey().catch(() => {
          // Reconnect failed. SignerRecovery handles it on the next user action.
        });
      }, debounceMs);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleReconnect();
      }
    };

    const onOnline = () => {
      scheduleReconnect();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [debounceMs]);
}
