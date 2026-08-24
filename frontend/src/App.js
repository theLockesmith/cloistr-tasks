import React, { useState, useEffect } from 'react';
import { ToastProvider, SharedAuthProvider, useSharedSession, SignerRecovery } from '@cloistr/ui/components';
import '@cloistr/ui/styles';
import { AuthProvider, useAuth } from './components/AuthContext';
import { useRelayReconnect } from './lib/useRelayReconnect';
import LoginScreen from './components/LoginScreen';
import AuthenticatedApp from './components/AuthenticatedApp';
import './App.css';

/**
 * Mounts the visibilitychange + online relay reconnect (Part 4 of the
 * signer-resilience design). Must be inside SharedAuthProvider so
 * useNostrAuth() is available. Renders nothing itself.
 *
 * @cloistr/ui 0.27.0 will export useRelayReconnect from the package. Until
 * that version is published to the registry, this mounts the local
 * implementation from src/lib/useRelayReconnect.js which is functionally
 * identical.
 */
function RelayReconnectMount() {
  useRelayReconnect();
  return null;
}

function AppContent() {
  const { isAuthenticated, loading, signerError, clearSignerError, retrySignerAuth } = useAuth();
  // Hold rendering while the SHARED session is still resolving.
  //
  // Without this, a 100ms timer was the only thing gating the decision, so an
  // already-signed-in user arriving from another *.cloistr.xyz app got the login
  // modal thrown up over an in-flight SSO restore — it reads as "you are logged
  // out" and is the same defect class already fixed in stash and in
  // @cloistr/ui 0.20.5 (reconnectingKnownSession).
  //
  // isResolving comes from SharedAuthProvider and is bounded by its own 12s
  // backstop, so this cannot hang the app if the restore never completes.
  const { isResolving } = useSharedSession();
  const [initializing, setInitializing] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setInitializing(false);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  if (loading || initializing || isResolving) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // A NIP-46 signing failure during SSO restore surfaces here as a recovery
  // screen rather than a login screen. The Nostr session is still valid — only
  // the backend JWT exchange failed. The user can retry (re-attempt signing) or
  // go back (return to the login screen with their Nostr session intact).
  //
  // "Go back" leads to LoginScreen, NOT a credential prompt. The Nostr
  // key remains connected in SharedAuthProvider; the user can attempt to
  // log in again from the login options without re-entering any credentials.
  if (signerError) {
    const handleRetry = async () => {
      setRetrying(true);
      try {
        await retrySignerAuth();
      } finally {
        setRetrying(false);
      }
    };

    return (
      <div className="app">
        <div className="loading">
          <SignerRecovery
            error={signerError}
            onRetry={handleRetry}
            onGoBack={clearSignerError}
            retrying={retrying}
          />
        </div>
      </div>
    );
  }

  return isAuthenticated() ? <AuthenticatedApp /> : <LoginScreen />;
}

function App() {
  return (
    <ToastProvider>
      <SharedAuthProvider>
        <RelayReconnectMount />
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </SharedAuthProvider>
    </ToastProvider>
  );
}

export default App;
