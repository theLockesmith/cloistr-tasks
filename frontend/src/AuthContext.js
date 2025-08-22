// frontend/src/AuthContext.js
// Keycloak authentication context

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
        // Exchange code for token
        await handleOAuthCallback(code, state);
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (token) {
        // Validate existing token
        await validateToken();
      }
      
      setLoading(false);
    };

    if (keycloakConfig) {
      initAuth();
    }
  }, [keycloakConfig, token]);

  const handleOAuthCallback = async (code, state) => {
    try {
      if (!keycloakConfig) return;

      // Prepare the token exchange request
      const requestBody = {
        grant_type: 'authorization_code',
        client_id: keycloakConfig.client_id,
        code: code,
        redirect_uri: REDIRECT_URI, // Use consistent redirect URI
      };

      // Add client secret if available
      if (keycloakConfig.client_secret) {
        requestBody.client_secret = keycloakConfig.client_secret;
      }

      console.log('Token exchange request:', {
        url: keycloakConfig.token_url,
        body: requestBody
      });

      // Exchange authorization code for access token
      const tokenResponse = await fetch(keycloakConfig.token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(requestBody),
      });

      console.log('Token response status:', tokenResponse.status);
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange error response:', errorText);
        
        // Try to parse error details
        try {
          const errorData = JSON.parse(errorText);
          console.error('Parsed error:', errorData);
        } catch (e) {
          console.error('Raw error text:', errorText);
        }
        
        throw new Error(`Token exchange failed: ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Token exchange successful');
      
      const accessToken = tokenData.access_token;

      // Store token and authenticate
      localStorage.setItem('token', accessToken);
      setToken(accessToken);

      // Validate token and get user info
      await validateToken(accessToken);
    } catch (error) {
      console.error('OAuth callback error:', error);
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

    // Redirect to Keycloak - use same redirect URI
    const authUrl = new URL(keycloakConfig.auth_url);
    authUrl.searchParams.set('client_id', keycloakConfig.client_id);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI); // Use consistent redirect URI
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
        logoutUrl.searchParams.set('redirect_uri', REDIRECT_URI); // Use consistent redirect URI
        
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