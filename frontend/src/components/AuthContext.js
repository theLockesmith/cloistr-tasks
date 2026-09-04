// src/components/AuthContext.js - Nostr Authentication Context
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNostrAuth } from '@cloistr/auth';
import { withSignerRetry } from '@cloistr/ui';
import {
  hasNostrExtension,
  waitForNostrExtension,
  authenticateWithExtension,
  authenticateWithBunker,
  createAuthEvent,
  formatPubkey
} from '../lib/nostr';
import {
  saveSharedSession,
  clearSharedSession,
  renewSession,
} from '../lib/session';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  // Track active Nostr key for re-scope on key switch (multi-identity support)
  const { authState, signer: activeSigner } = useNostrAuth();

  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [tokenExpiry, setTokenExpiry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [authError, setAuthError] = useState(null);

  // signerError is set when a NIP-46 signing attempt fails during an
  // SSO restore. It is DISTINCT from authError (which is for login-flow
  // failures) and from session state (which is never cleared on signing
  // failures). While signerError is set, App.js renders SignerRecovery
  // instead of LoginScreen so the user knows their session is intact.
  const [signerError, setSignerError] = useState(null);

  // True for the ENTIRE attemptSignerAuth run, including the waits between
  // retries. loginWithSigner clears `loading` in its own finally on every failed
  // attempt, so without this flag the gaps between retries look identical to
  // "settled, not signed in" and AppContent renders LoginScreen underneath an
  // auth attempt that is still in flight.
  //
  // Observed in production 2026-08-28 01:12:43-01:12:57 (tasks-backend access
  // log): challenge at :43 failed because the nostrconnect signer session was
  // not connected until :44.98, the 1500ms retry re-issued a challenge at :45,
  // and the exchange only completed at :57. The user was shown the sign-in
  // screen mid-flight and reloaded the page at :42 in response.
  const [signerAuthPending, setSignerAuthPending] = useState(false);

  const refreshTimerRef = useRef(null);
  // Stable ref to the current signer so retrySignerAuth (exposed on context)
  // can read it without requiring a dependency that would re-create the callback
  // on every auth state change.
  const activeSignerRef = useRef(activeSigner);

  const API_BASE = import.meta.env.VITE_API_URL || '/api';

  // Clear all auth state
  const clearAuth = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('token_expiry');
    localStorage.removeItem('user_pubkey');
    setUser(null);
    setToken(null);
    setTokenExpiry(null);
    setAuthError(null);
    // Clear shared session for cross-subdomain SSO
    clearSharedSession();
  }, []);

  // Schedule token refresh
  const scheduleTokenRefresh = useCallback((expiryTime) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const now = new Date();
    const expiry = new Date(expiryTime);
    const timeUntilExpiry = expiry.getTime() - now.getTime();

    // Refresh 2 minutes before expiry or at half the token lifetime
    const refreshIn = Math.min(timeUntilExpiry - 2 * 60 * 1000, timeUntilExpiry / 2);

    if (refreshIn > 0) {
      console.log(`Token refresh scheduled in ${Math.round(refreshIn / 1000 / 60)} minutes`);
      refreshTimerRef.current = setTimeout(() => {
        refreshToken();
      }, refreshIn);
    }
  }, []);

  // Refresh token
  const refreshToken = useCallback(async () => {
    try {
      const currentToken = localStorage.getItem('access_token');
      if (!currentToken) {
        clearAuth();
        return;
      }

      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`
        }
      });

      if (!response.ok) {
        console.error('Token refresh failed');
        clearAuth();
        return;
      }

      const data = await response.json();

      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('token_expiry', data.expires_at);

      setToken(data.access_token);
      setTokenExpiry(data.expires_at);

      scheduleTokenRefresh(data.expires_at);

      // Auto-renew SSO cookies on token refresh
      renewSession();

      console.log('Token refreshed successfully');
    } catch (error) {
      console.error('Token refresh error:', error);
      clearAuth();
    }
  }, [API_BASE, clearAuth, scheduleTokenRefresh]);

  // Validate existing token on load
  const validateToken = useCallback(async () => {
    const storedToken = localStorage.getItem('access_token');
    const storedExpiry = localStorage.getItem('token_expiry');

    if (!storedToken || !storedExpiry) {
      clearAuth();
      return false;
    }

    // Check if token is expired
    const now = new Date();
    const expiry = new Date(storedExpiry);
    if (now >= expiry) {
      console.log('Token expired, clearing auth');
      clearAuth();
      return false;
    }

    try {
      // Validate with server
      const response = await fetch(`${API_BASE}/auth/token-info`, {
        headers: {
          'Authorization': `Bearer ${storedToken}`
        }
      });

      if (!response.ok) {
        clearAuth();
        return false;
      }

      const data = await response.json();

      setUser(data.user);
      setToken(storedToken);
      setTokenExpiry(storedExpiry);

      scheduleTokenRefresh(storedExpiry);
      return true;
    } catch (error) {
      console.error('Token validation error:', error);
      clearAuth();
      return false;
    }
  }, [API_BASE, clearAuth, scheduleTokenRefresh]);

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      setLoading(true);

      // Check for extension
      const hasExtension = await waitForNostrExtension(2000);
      setExtensionAvailable(hasExtension);

      // Try to validate existing token
      await validateToken();

      setLoading(false);
    };

    initAuth();
  }, [validateToken]);

  // Login with NIP-07 extension
  const loginWithExtension = useCallback(async () => {
    setLoading(true);
    setAuthError(null);

    try {
      if (!hasNostrExtension()) {
        throw new Error('No Nostr extension found. Please install nos2x, Alby, or another NIP-07 compatible extension.');
      }

      const authResult = await authenticateWithExtension(API_BASE);

      // Store auth data
      localStorage.setItem('access_token', authResult.access_token);
      localStorage.setItem('token_expiry', authResult.expires_at);
      localStorage.setItem('user_pubkey', authResult.user.pubkey);

      setUser(authResult.user);
      setToken(authResult.access_token);
      setTokenExpiry(authResult.expires_at);

      scheduleTokenRefresh(authResult.expires_at);

      // Save to shared session for cross-subdomain SSO
      saveSharedSession({
        method: 'nip07',
        pubkey: authResult.user.pubkey,
      });

      console.log('Login successful for:', formatPubkey(authResult.user.pubkey));
      return authResult;
    } catch (error) {
      console.error('Login error:', error);
      setAuthError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [API_BASE, scheduleTokenRefresh]);

  // Login with NIP-46 bunker
  const loginWithBunker = useCallback(async (bunkerUrl) => {
    setLoading(true);
    setAuthError(null);

    try {
      const authResult = await authenticateWithBunker(API_BASE, bunkerUrl);

      // Store auth data
      localStorage.setItem('access_token', authResult.access_token);
      localStorage.setItem('token_expiry', authResult.expires_at);
      localStorage.setItem('user_pubkey', authResult.user.pubkey);

      setUser(authResult.user);
      setToken(authResult.access_token);
      setTokenExpiry(authResult.expires_at);

      scheduleTokenRefresh(authResult.expires_at);

      // Save to shared session for cross-subdomain SSO
      saveSharedSession({
        method: 'nip46',
        pubkey: authResult.user.pubkey,
        bunkerUrl,
      });

      console.log('Bunker login successful for:', formatPubkey(authResult.user.pubkey));
      return authResult;
    } catch (error) {
      console.error('Bunker login error:', error);
      setAuthError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [API_BASE, scheduleTokenRefresh]);

  // Login with an already-connected @cloistr/auth SignerInterface.
  // Used by LoginScreen after LoginModal completes (NIP-07, NIP-46, or
  // password+nostrconnect) so we never call connectNip07/connectNip46 twice.
  const loginWithSigner = useCallback(async (signer) => {
    setLoading(true);
    setAuthError(null);

    try {
      const pubkey = await signer.getPublicKey();

      // Challenge/sign/verify against the tasks backend
      const challengeResponse = await fetch(`${API_BASE}/auth/challenge`);
      if (!challengeResponse.ok) throw new Error('Failed to get challenge');
      const { challenge, nonce } = await challengeResponse.json();

      const unsignedEvent = createAuthEvent(pubkey, challenge, nonce);
      // withSignerRetry retries ONLY for retryable failures (relay unreachable,
      // socket closed). A denial from the signer (CANCELLED, REMOTE_ERROR) is
      // rethrown immediately — retrying a refusal would re-prompt the user for
      // something they already declined, which is worse than failing once.
      const signedEvent = await withSignerRetry(() => signer.signEvent(unsignedEvent));

      const verifyResponse = await fetch(`${API_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedEvent })
      });

      if (!verifyResponse.ok) {
        // The error path must not assume JSON. A gateway 504 returns an HTML
        // page, and `await verifyResponse.json()` then threw
        //   SyntaxError: Unexpected token '<', "<html><bod"...
        // which MASKED the real problem — observed in production while the
        // cluster was stalling. Report the status, and use a parsed body only
        // when there actually is one.
        const raw = await verifyResponse.text().catch(() => '');
        let detail = '';
        try {
          detail = JSON.parse(raw).error || '';
        } catch {
          detail = raw.slice(0, 120);
        }
        const err = new Error(
          `Authentication failed: HTTP ${verifyResponse.status}${detail ? ` — ${detail}` : ''}`,
        );
        // Mark server/gateway failures so callers can retry them rather than
        // treating them as a rejected identity.
        err.transient = verifyResponse.status >= 500;
        throw err;
      }

      const authResult = await verifyResponse.json();

      localStorage.setItem('access_token', authResult.access_token);
      localStorage.setItem('token_expiry', authResult.expires_at);
      localStorage.setItem('user_pubkey', authResult.user.pubkey);

      setUser(authResult.user);
      setToken(authResult.access_token);
      setTokenExpiry(authResult.expires_at);

      scheduleTokenRefresh(authResult.expires_at);

      saveSharedSession({
        method: 'nip07',
        pubkey: authResult.user.pubkey,
      });

      console.log('LoginModal signer login successful for:', formatPubkey(authResult.user.pubkey));
      return authResult;
    } catch (error) {
      console.error('loginWithSigner error:', error);
      setAuthError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [API_BASE, scheduleTokenRefresh]);

  // Logout
  const logout = useCallback(() => {
    console.log('Logging out');
    clearAuth();
  }, [clearAuth]);

  // Check if authenticated
  const isAuthenticated = useCallback(() => {
    return !!token && !!user;
  }, [token, user]);

  // Get authorization headers
  const getAuthHeaders = useCallback(() => {
    if (!token) return {};
    return {
      'Authorization': `Bearer ${token}`
    };
  }, [token]);

  // Make authenticated API call
  const apiCall = useCallback(async (url, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
      ...getAuthHeaders()
    };

    try {
      let response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers
      });

      // Handle 401/403 - try to refresh and retry
      if (response.status === 401 || response.status === 403) {
        const errorData = await response.json().catch(() => ({}));

        if (errorData.action === 'login_required') {
          clearAuth();
          throw new Error('Session expired. Please log in again.');
        }

        // Try refresh
        await refreshToken();

        // Retry with new token
        const newHeaders = {
          'Content-Type': 'application/json',
          ...options.headers,
          ...getAuthHeaders()
        };

        response = await fetch(`${API_BASE}${url}`, {
          ...options,
          headers: newHeaders
        });

        if (!response.ok) {
          clearAuth();
          throw new Error('Session expired. Please log in again.');
        }
      }

      return response;
    } catch (error) {
      console.error('API call error:', error);
      throw error;
    }
  }, [API_BASE, getAuthHeaders, clearAuth, refreshToken]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Re-scope on active-key change: when the Header key switcher changes
  // authState.activePubkey, the stored JWT is stale for the new key. We
  // re-run the challenge/verify flow to obtain a fresh JWT for the new
  // identity and clear the old task data by resetting user state.
  //
  // Loop guard: skip if the new activePubkey already matches the JWT's pubkey
  // (stored in localStorage as 'user_pubkey'). This prevents re-auth on the
  // initial mount render when activePubkey and user_pubkey are already in sync,
  // and prevents double-fires if the effect runs twice with the same key.
  // Keep activeSignerRef in sync with the latest signer from useNostrAuth.
  useEffect(() => {
    activeSignerRef.current = activeSigner;
  }, [activeSigner]);

  /**
   * Attempt to exchange the current Nostr signer for a tasks backend JWT.
   *
   * Called when SharedAuthProvider restores an SSO session (the Nostr identity
   * is known but tasks has no JWT for it yet), and again when the user clicks
   * "Try again" on the SignerRecovery screen.
   *
   * On persistent failure it sets signerError (showing SignerRecovery) instead
   * of falling through to LoginScreen. The Nostr session is NEVER touched.
   */
  const attemptSignerAuth = useCallback(async () => {
    const signer = activeSignerRef.current;
    if (!signer) return;

    // Clear any previous recovery screen before trying.
    setSignerError(null);
    // Held across the whole loop — including the waits below — so the UI can
    // keep showing the restore gate instead of flashing the sign-in screen.
    setSignerAuthPending(true);

    try {
      const delays = [0, 1500, 4000];
      let lastError;
      for (const wait of delays) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        try {
          await loginWithSigner(signer);
          // Success: JWT obtained. signerError is already null.
          return;
        } catch (err) {
          lastError = err;
          // A rejected identity (denial, malformed request) will not change on
          // retry. Only server errors (transient=true) and network-level
          // TypeErrors are worth repeating.
          if (!err?.transient && err?.name !== 'TypeError') break;
        }
      }

      console.error('Auth from restored shared session failed:', lastError);
      // Surface the recovery screen rather than falling through to LoginScreen.
      // The Nostr session is still valid; this is a signing/backend failure.
      setSignerError(lastError);
      // Reset so the next key observation re-triggers auth (key switch or reload).
      activePubkeyRef.current = null;
    } finally {
      // Always clears: the loop above always ends in success (early return) or
      // setSignerError, so the gate this drives is bounded and cannot hang.
      setSignerAuthPending(false);
    }
  }, [loginWithSigner]); // activeSignerRef is stable; loginWithSigner is memoized

  /** Clear the recovery screen. Goes back to LoginScreen (Nostr session intact). */
  const clearSignerError = useCallback(() => {
    setSignerError(null);
  }, []);

  const activePubkeyRef = useRef(null);
  useEffect(() => {
    const newPubkey = authState.activePubkey;

    // Not connected or no signer yet — nothing to re-scope
    if (!newPubkey || !activeSigner) return;

    // First observation of an active key.
    //
    // This used to record the key and return UNCONDITIONALLY, which meant a
    // user arriving with a restored shared session was never logged in to
    // tasks: SharedAuthProvider completes the NIP-46 restore, activePubkey
    // appears, this effect files it away, no key "switch" ever follows, and
    // AuthContext still holds no JWT — so AppContent renders LoginScreen to
    // someone who is demonstrably signed in.
    //
    // Measured against production before this change: POST
    // /api/v1/nostrconnect/session returned 200 on 6 of 6 loads, the relay
    // websocket opened every time, and all 6 still showed the sign-in screen.
    // The network path was never the problem here.
    //
    // The guard's real intent was only to avoid clobbering an ALREADY VALID
    // session on mount. Keep exactly that, and otherwise authenticate.
    if (activePubkeyRef.current === null) {
      activePubkeyRef.current = newPubkey;

      const storedPubkey = localStorage.getItem('user_pubkey');
      const storedToken = localStorage.getItem('access_token');
      const storedExpiry = localStorage.getItem('token_expiry');
      const jwtIsUsable =
        !!storedToken &&
        storedPubkey === newPubkey &&
        !!storedExpiry &&
        new Date(storedExpiry) > new Date();

      // Already signed in to tasks with this key — leave it alone.
      if (jwtIsUsable) return;

      // Shared session restored but tasks has no usable JWT for it: exchange
      // the signer for one instead of showing a sign-in screen.
      // Retried with backoff, because the tasks backend intermittently returns
      // 504 while the cluster is stalling. Measured over 8 production loads:
      // the exchange fired every time, 1 succeeded, 7 died on a gateway 504.
      // Without a retry a single blip drops the user onto a sign-in screen
      // despite a perfectly valid session — the exact symptom this change set
      // exists to remove.
      attemptSignerAuth();
      return;
    }

    // Key unchanged since last render — no switch occurred
    if (newPubkey === activePubkeyRef.current) return;

    // Key changed. Check if JWT already matches the new key (e.g. if the app
    // reloaded with the right key already active).
    const jwtPubkey = localStorage.getItem('user_pubkey');
    if (newPubkey === jwtPubkey) {
      activePubkeyRef.current = newPubkey;
      return;
    }

    // New key that doesn't match the current JWT → re-auth.
    const prevPubkey = activePubkeyRef.current;
    activePubkeyRef.current = newPubkey;

    console.log(`Key switch detected: ${prevPubkey?.slice(0, 8)} → ${newPubkey.slice(0, 8)}; re-authenticating with tasks backend`);

    loginWithSigner(activeSigner).catch((err) => {
      console.error('Re-auth after key switch failed:', err);
      // Roll back ref so the next activePubkey change can retry
      activePubkeyRef.current = prevPubkey;
    });
  }, [authState.activePubkey, activeSigner, loginWithSigner]);

  const value = {
    user,
    token,
    loading,
    extensionAvailable,
    authError,
    // Signer-resilience state (Parts 1-4)
    signerError,
    signerAuthPending,
    clearSignerError,
    retrySignerAuth: attemptSignerAuth,
    loginWithExtension,
    loginWithBunker,
    loginWithSigner,
    logout,
    isAuthenticated,
    getAuthHeaders,
    apiCall,
    formatPubkey
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
