// src/components/AuthContext.js - Nostr Authentication Context
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  hasNostrExtension,
  waitForNostrExtension,
  authenticateWithExtension,
  authenticateWithBunker,
  formatPubkey
} from '../lib/nostr';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [tokenExpiry, setTokenExpiry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [authError, setAuthError] = useState(null);

  const refreshTimerRef = useRef(null);

  const API_BASE = process.env.REACT_APP_API_URL || '/api';

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

  const value = {
    user,
    token,
    loading,
    extensionAvailable,
    authError,
    loginWithExtension,
    loginWithBunker,
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
