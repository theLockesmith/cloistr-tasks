// middleware/auth.js - Enhanced with better error handling and debugging
require('dotenv').config();

// Function to validate token with Keycloak and get user info
async function validateTokenWithKeycloak(token) {
  try {
    const userInfoUrl = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/userinfo`;
    
    console.log('Validating token with Keycloak:', userInfoUrl);
    
    const response = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('Keycloak validation response:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('Keycloak validation error details:', errorText);
      return null;
    }

    const keycloakUser = await response.json();
    console.log('Token validated successfully for user:', keycloakUser.preferred_username);
    
    // Transform Keycloak user to our format
    return {
      id: keycloakUser.sub,
      email: keycloakUser.email,
      username: keycloakUser.preferred_username,
      firstName: keycloakUser.given_name,
      lastName: keycloakUser.family_name,
      roles: keycloakUser.realm_access?.roles || []
    };
  } catch (error) {
    console.error('Error validating token with Keycloak:', error);
    return null;
  }
}

// Authentication middleware - validates token and sets req.user
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    console.log('=== AUTH DEBUG ===');
    console.log('Auth header present:', !!authHeader);
    console.log('Token present:', !!token);
    console.log('Token length:', token ? token.length : 0);
    console.log('Token start:', token ? token.substring(0, 20) + '...' : 'none');
    console.log('==================');

    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ 
        error: 'Access token required',
        keycloak_url: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/auth`
      });
    }

    // Validate token with Keycloak
    const user = await validateTokenWithKeycloak(token);
    
    if (!user) {
      console.log('Token validation failed - token invalid or expired');
      return res.status(403).json({ 
        error: 'Invalid or expired token',
        action: 'refresh_required',
        keycloak_url: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/auth`
      });
    }

    console.log('Authentication successful for user:', user.username);
    
    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(403).json({ 
      error: 'Token verification failed',
      details: error.message,
      keycloak_url: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/auth`
    });
  }
};

// Optional authentication middleware - validates token if present but doesn't require it
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      req.user = null;
      return next();
    }

    // Validate token with Keycloak
    const user = await validateTokenWithKeycloak(token);
    req.user = user; // Will be null if validation failed
    
    next();
  } catch (error) {
    console.error('Optional auth error:', error);
    req.user = null;
    next();
  }
};

// Ownership middleware - ensures user owns the resource
const requireOwnership = (resourceQuery) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // This middleware assumes you have a database pool available
      // You might need to adjust this based on your setup
      const { pool } = require('../database/init');
      
      // Extract resource ID from request params
      const resourceId = req.params.listId || req.params.taskId || req.params.templateId;
      
      if (!resourceId) {
        return res.status(400).json({ error: 'Resource ID required' });
      }

      // Check ownership based on resource type
      let query;
      if (req.params.listId) {
        query = 'SELECT user_id FROM task_lists WHERE id = $1';
      } else if (req.params.taskId) {
        query = `
          SELECT tl.user_id FROM tasks t
          JOIN task_lists tl ON t.list_id = tl.id
          WHERE t.id = $1
        `;
      } else if (req.params.templateId) {
        query = `
          SELECT tl.user_id FROM task_templates tt
          JOIN task_lists tl ON tt.list_id = tl.id
          WHERE tt.id = $1
        `;
      }

      const result = await pool.query(query, [resourceId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      if (result.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json({ error: 'Failed to verify ownership' });
    }
  };
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireOwnership,
  validateTokenWithKeycloak
};