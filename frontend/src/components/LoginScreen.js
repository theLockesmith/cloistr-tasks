import React from 'react';
import { useAuth } from '../AuthContext';

function LoginScreen() {
  const { login, keycloakConfig, loading } = useAuth();

  if (loading || !keycloakConfig) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="login-container">
        <div className="login-card">
          <h1>Daily Task Manager</h1>
          <p>Organize your daily routines and track your progress</p>
          
          <button onClick={login} className="btn btn-primary login-btn">
            Sign In with Keycloak
          </button>
          
          <div className="login-features">
            <h3>Features:</h3>
            <ul>
              <li>Personal task lists and routines</li>
              <li>Customizable reset schedules</li>
              <li>Progress tracking and analytics</li>
              <li>Flexible time-based scheduling</li>
              <li>Secure user authentication</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;