import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
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
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;