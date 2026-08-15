import React, { useState, useEffect } from 'react';
import { ToastProvider, SharedAuthProvider, useSharedSession } from '@cloistr/ui/components';
import '@cloistr/ui/styles';
import { AuthProvider, useAuth } from './components/AuthContext';
import LoginScreen from './components/LoginScreen';
import AuthenticatedApp from './components/AuthenticatedApp';
import './App.css';

function AppContent() {
  const { isAuthenticated, loading } = useAuth();
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

  return isAuthenticated() ? <AuthenticatedApp /> : <LoginScreen />;
}

function App() {
  return (
    <ToastProvider>
      <SharedAuthProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </SharedAuthProvider>
    </ToastProvider>
  );
}

export default App;
