// Enhanced AuthContext.js with refresh token support
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

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
  const [token, setToken] = useState(localStorage.getItem('access_token'));
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem('refresh_token'));
  const [tokenExpiry, setTokenExpiry] = useState(localStorage.getItem('token_expiry'));
  const [loading, setLoading] = useState(true);
  const [keycloakConfig, setKeycloakConfig] = useState(null);
  
  // Ref to track if we're currently refreshing to prevent multiple simultaneous refreshes
  const refreshingRef = useRef(false);
  const refreshTimerRef = useRef(null);

  // API base URL
  const API_BASE = process.env.REACT_APP_API_URL || '/api';
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

  // Schedule automatic token refresh
  const scheduleTokenRefresh = (expiryTime) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const now = new Date().getTime();
    const expiry = new Date(expiryTime).getTime();
    const timeUntilExpiry = expiry - now;
    
    // Refresh 2 minutes before expiry (or halfway through if token life < 4 minutes)
    const refreshBuffer = Math.min(2 * 60 * 1000, timeUntilExpiry / 2);
    const refreshTime = timeUntilExpiry - refreshBuffer;

    console.log(`Token expires in ${timeUntilExpiry/1000/60} minutes, will refresh in ${refreshTime/1000/60} minutes`);

    if (refreshTime > 0) {
      refreshTimerRef.current = setTimeout(() => {
        console.log('Auto-refreshing token...');
        refreshTokenSilently();
      }, refreshTime);
    }
  };

  // Silent token refresh
  const refreshTokenSilently = async () => {
    if (refreshingRef.current || !refreshToken) {
      return false;
    }

    refreshingRef.current = true;
    
    try {
      console.log('Attempting silent token refresh...');
      
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Update tokens
        setToken(data.access_token);
        setRefreshToken(data.refresh_token);
        setTokenExpiry(data.expires_at);
        
        // Store in localStorage
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('token_expiry', data.expires_at);
        
        // Schedule next refresh
        scheduleTokenRefresh(data.expires_at);
        
        console.log('Token refreshed successfully');
        return true;
      } else {
        console.log('Token refresh failed, user needs to re-login');
        logout();
        return false;
      }
    } catch (error) {
      console.error('Silent token refresh error:', error);
      logout();
      return false;
    } finally {
      refreshingRef.current = false;
    }
  };

  // Initialize authentication
  useEffect(() => {
    const initAuth = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');

      if (code && state) {
        const processingKey = `processing_${code}`;
        if (sessionStorage.getItem(processingKey)) {
          setLoading(false);
          return;
        }

        sessionStorage.setItem(processingKey, 'true');
        
        try {
          await handleOAuthCallback(code, state);
        } finally {
          sessionStorage.removeItem(processingKey);
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } else if (token && tokenExpiry) {
        // Check if token is expired
        const now = new Date().getTime();
        const expiry = new Date(tokenExpiry).getTime();
        
        if (now >= expiry) {
          console.log('Stored token is expired, attempting refresh...');
          const refreshed = await refreshTokenSilently();
          if (!refreshed) {
            // Refresh failed, validate anyway to trigger proper cleanup
            await validateToken();
          }
        } else {
          // Token still valid, validate and schedule refresh
          const isValid = await validateToken();
          if (isValid) {
            scheduleTokenRefresh(tokenExpiry);
          }
        }
      }
      
      setLoading(false);
    };

    // Check for auth code in URL
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    
    if (authCode || keycloakConfig || token) {
      initAuth();
    } else {
      setLoading(false);
    }
  }, [keycloakConfig, token, tokenExpiry]);

  const handleOAuthCallback = async (code, state) => {
    try {
      const response = await fetch(`${API_BASE}/auth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          state: state,
          redirect_uri: REDIRECT_URI
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Backend token exchange error:', errorData);
        
        if (errorData.details?.error === 'invalid_grant') {
          window.history.replaceState({}, document.title, window.location.pathname);
          setLoading(false);
          return;
        }
        
        throw new Error(`Backend token exchange failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('OAuth callback result:', { 
        hasAccessToken: !!result.access_token,
        hasRefreshToken: !!result.refresh_token,
        expiresIn: result.expires_in 
      });
      
      // Store tokens and user data
      const accessToken = result.access_token;
      const newRefreshToken = result.refresh_token;
      const expiresAt = result.expires_at;
      const userData = result.user;

      setToken(accessToken);
      setRefreshToken(newRefreshToken);
      setTokenExpiry(expiresAt);
      setUser(userData);

      // Store in localStorage
      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('refresh_token', newRefreshToken);
      localStorage.setItem('token_expiry', expiresAt);

      // Schedule automatic refresh
      scheduleTokenRefresh(expiresAt);

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
        // Token invalid, try refresh if we have refresh token
        if (refreshToken && !refreshingRef.current) {
          console.log('Token validation failed, attempting refresh...');
          const refreshed = await refreshTokenSilently();
          return refreshed;
        } else {
          logout();
          return false;
        }
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

    const state = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('oauth_state', state);

    const authUrl = new URL(keycloakConfig.auth_url);
    authUrl.searchParams.set('client_id', keycloakConfig.client_id);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);

    window.location.href = authUrl.toString();
  };

  const logout = async () => {
    try {
      // Clear refresh timer
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      // Clear local storage
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('token_expiry');
      localStorage.removeItem('oauth_state');
      
      setToken(null);
      setRefreshToken(null);
      setTokenExpiry(null);
      setUser(null);

      if (keycloakConfig && token) {
        // Logout from Keycloak
        const logoutUrl = new URL(keycloakConfig.logout_url);
        logoutUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        window.location.href = logoutUrl.toString();
      }
    } catch (error) {
      console.error('Logout error:', error);
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

    let response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
    });

    // If 401 and we have a refresh token, try refreshing once
    if (response.status === 401 && refreshToken && !refreshingRef.current) {
      console.log('API call got 401, attempting token refresh...');
      const refreshed = await refreshTokenSilently();
      
      if (refreshed) {
        // Retry the original request with new token
        const newHeaders = {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          ...options.headers,
        };
        
        response = await fetch(`${API_BASE}${url}`, {
          ...options,
          headers: newHeaders,
        });
      }
    }

    if (response.status === 401) {
      logout();
      throw new Error('Authentication required');
    }

    return response;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

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
    refreshTokenSilently
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};