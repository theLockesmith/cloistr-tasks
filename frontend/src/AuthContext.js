// frontend/src/AuthContext.js
// Keycloak authentication context with backend token exchange

import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [keycloakConfig, setKeycloakConfig] = useState(null);

  // API base URL
  const API_BASE = process.env.REACT_APP_API_URL || '/api';

  // Use consistent redirect URI
  const REDIRECT_URI = 'https://tasks.coldforge.xyz';

  // Load Keycloak configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/config`);
        const config = await response.json();
        console.log('Keycloak config loaded:', { 
          client_id: config.client_id,
          auth_url: config.auth_url 
        });
        setKeycloakConfig(config);
      } catch (error) {
        console.error('Failed to load auth config:', error);
      }
    };
    loadConfig();
  }, [API_BASE]);

  // Initialize authentication
  useEffect(() => {
    const initAuth = async () => {
      // Check for auth code in URL (OAuth callback)
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');

      if (code && state) {
        // Check if we're already processing this code
        const processingKey = `processing_${code}`;
        if (sessionStorage.getItem(processingKey)) {
          console.log('Auth code already being processed, skipping...');
          setLoading(false);
          return;
        }

        // Mark this code as being processed
        sessionStorage.setItem(processingKey, 'true');
        
        console.log('Auth code detected, exchanging via backend');
        
        try {
          // Exchange code for token via backend
          await handleOAuthCallback(code, state);
        } finally {
          // Clean up processing flag and URL
          sessionStorage.removeItem(processingKey);
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } else if (token) {
        // Validate existing token
        await validateToken();
      }
      
      setLoading(false);
    };

    // Process auth code immediately, don't wait for keycloak config
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
      // If we have an auth code, process it immediately
      initAuth();
    } else if (keycloakConfig) {
      // Otherwise wait for config for other operations
      initAuth();
    } else if (!keycloakConfig && !code) {
      // No code and no config yet, just wait for config
      setLoading(false);
    }
  }, [keycloakConfig, token]);

  const handleOAuthCallback = async (code, state) => {
    try {
      console.log('Starting backend token exchange for code:', code.substring(0, 8) + '...');
      const startTime = Date.now();

      // Let backend handle the token exchange
      const response = await fetch(`${API_BASE}/auth/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: code,
          state: state,
          redirect_uri: REDIRECT_URI
        }),
      });

      const elapsed = Date.now() - startTime;
      console.log(`Backend token exchange response: ${response.status} (${elapsed}ms elapsed)`);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Backend token exchange error:', errorData);
        
        // If it's a "code not valid" error, don't retry - just clear the URL
        if (errorData.details?.error === 'invalid_grant') {
          console.log('Auth code invalid/expired, clearing URL and staying logged out');
          window.history.replaceState({}, document.title, window.location.pathname);
          setLoading(false);
          return;
        }
        
        throw new Error(`Backend token exchange failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('Backend token exchange successful');
      
      // Backend returns both token and user info
      const accessToken = result.token;
      const userData = result.user;

      // Store token and set user
      localStorage.setItem('token', accessToken);
      setToken(accessToken);
      setUser(userData);

    } catch (error) {
      console.error('OAuth callback error:', error);
      
      // Don't call logout on auth code errors - just clear state
      if (error.message.includes('Backend token exchange failed')) {
        setLoading(false);
        return;
      }
      
      logout();
    }
  };

  const validateToken = async (tokenToValidate = token) => {
    if (!tokenToValidate) {
      setUser(null);
      return false;
    }

    try {
      // Validate token with backend
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenToValidate}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData.user);
        return true;
      } else {
        // Token invalid
        logout();
        return false;
      }
    } catch (error) {
      console.error('Token validation error:', error);
      logout();
      return false;
    }
  };

  const login = () => {
    if (!keycloakConfig) {
      console.error('Keycloak configuration not loaded');
      return;
    }

    // Generate state for CSRF protection
    const state = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('oauth_state', state);

    // Redirect to Keycloak
    const authUrl = new URL(keycloakConfig.auth_url);
    authUrl.searchParams.set('client_id', keycloakConfig.client_id);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);

    console.log('Redirecting to auth URL:', authUrl.toString());
    window.location.href = authUrl.toString();
  };

  const logout = async () => {
    try {
      if (keycloakConfig && token) {
        // Logout from Keycloak
        const logoutUrl = new URL(keycloakConfig.logout_url);
        logoutUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        
        // Clear local storage first
        localStorage.removeItem('token');
        localStorage.removeItem('oauth_state');
        setToken(null);
        setUser(null);

        // Redirect to Keycloak logout
        window.location.href = logoutUrl.toString();
      } else {
        // Local logout only
        localStorage.removeItem('token');
        localStorage.removeItem('oauth_state');
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error('Logout error:', error);
      // Force local logout on error
      localStorage.removeItem('token');
      localStorage.removeItem('oauth_state');
      setToken(null);
      setUser(null);
    }
  };

  const isAuthenticated = () => {
    return !!(token && user);
  };

  const getAuthHeaders = () => {
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  const apiCall = async (url, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    };

    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      // Token expired or invalid
      logout();
      throw new Error('Authentication required');
    }

    return response;
  };

  const value = {
    user,
    token,
    loading,
    keycloakConfig,
    login,
    logout,
    isAuthenticated,
    getAuthHeaders,
    apiCall,
    validateToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;