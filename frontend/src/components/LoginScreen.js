import React, { useState } from 'react';
import { useAuth } from './AuthContext';

function LoginScreen() {
  const { loginWithExtension, loginWithBunker, extensionAvailable, loading, authError } = useAuth();
  const [bunkerUrl, setBunkerUrl] = useState('');
  const [showBunker, setShowBunker] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleExtensionLogin = async () => {
    setLocalError(null);
    try {
      await loginWithExtension();
    } catch (error) {
      setLocalError(error.message);
    }
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUrl.trim()) {
      setLocalError('Please enter a bunker URL');
      return;
    }
    setLocalError(null);
    try {
      await loginWithBunker(bunkerUrl);
    } catch (error) {
      setLocalError(error.message);
    }
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  const displayError = localError || authError;

  return (
    <div className="app">
      <div className="login-container">
        <div className="login-card">
          <img
            src="/cloistr-icon.svg"
            alt="Cloistr"
            style={{ width: '80px', height: '80px', marginBottom: '16px' }}
          />
          <h1>Cloistr Tasks</h1>
          <p>Daily task management with Nostr authentication</p>

          {displayError && (
            <div className="error-message" style={{
              color: '#dc3545',
              backgroundColor: '#f8d7da',
              padding: '10px',
              borderRadius: '4px',
              marginBottom: '15px'
            }}>
              {displayError}
            </div>
          )}

          <div className="login-methods">
            {extensionAvailable ? (
              <button
                onClick={handleExtensionLogin}
                className="btn btn-primary login-btn"
                style={{ marginBottom: '10px' }}
              >
                Sign in with Nostr Extension
              </button>
            ) : (
              <div style={{ marginBottom: '15px' }}>
                <p style={{ color: '#666', fontSize: '14px' }}>
                  No Nostr extension detected. Install{' '}
                  <a href="https://getalby.com" target="_blank" rel="noopener noreferrer">Alby</a>,{' '}
                  <a href="https://github.com/nickytonline/nos2x" target="_blank" rel="noopener noreferrer">nos2x</a>, or another NIP-07 extension.
                </p>
                <button
                  onClick={handleExtensionLogin}
                  className="btn btn-secondary login-btn"
                  style={{ marginBottom: '10px', opacity: 0.7 }}
                >
                  Try Extension Login Anyway
                </button>
              </div>
            )}

            <div style={{ textAlign: 'center', margin: '15px 0', color: '#666' }}>
              or
            </div>

            {!showBunker ? (
              <button
                onClick={() => setShowBunker(true)}
                className="btn btn-secondary"
                style={{ width: '100%' }}
              >
                Use Bunker (NIP-46)
              </button>
            ) : (
              <div className="bunker-input" style={{ marginTop: '10px' }}>
                <input
                  type="text"
                  placeholder="bunker://..."
                  value={bunkerUrl}
                  onChange={(e) => setBunkerUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginBottom: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={handleBunkerLogin}
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                  >
                    Connect
                  </button>
                  <button
                    onClick={() => setShowBunker(false)}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="login-features" style={{ marginTop: '30px' }}>
            <h3>Features:</h3>
            <ul>
              <li>Personal task lists and routines</li>
              <li>Customizable reset schedules</li>
              <li>Progress tracking and analytics</li>
              <li>Secure Nostr-based authentication</li>
              <li>No email or password required</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;
