import React, { useState, useEffect } from 'react';
import { ToastProvider, SharedAuthProvider } from '@cloistr/ui/components';
import '@cloistr/ui/styles';
import { AuthProvider, useAuth } from './components/AuthContext';
import LoginScreen from './components/LoginScreen';
import AuthenticatedApp from './components/AuthenticatedApp';
import './App.css';

function AppContent() {
  const { isAuthenticated, loading } = useAuth();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setInitializing(false);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  if (loading || initializing) {
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
