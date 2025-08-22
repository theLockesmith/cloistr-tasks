// backend/middleware/auth.js
// Keycloak authentication middleware

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// Keycloak configuration
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'https://auth.your-domain.com';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'master';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'task-manager';

// JWKS client for token verification
const client = jwksClient({
  jwksUri: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`,
  requestHeaders: {}, 
  timeout: 30000,
});

// Get signing key for JWT verification
function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

// Extract user information from token
function extractUserInfo(decoded) {
  return {
    id: decoded.sub,
    email: decoded.email,
    username: decoded.preferred_username,
    firstName: decoded.given_name,
    lastName: decoded.family_name,
    roles: decoded.realm_access?.roles || [],
    groups: decoded.groups || []
  };
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      keycloak_url: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?client_id=${KEYCLOAK_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(req.get('origin') || 'http://localhost:3000')}`
    });
  }

  jwt.verify(token, getKey, {
    audience: KEYCLOAK_CLIENT_ID,
    issuer: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      console.error('Token verification failed:', err);
      return res.status(403).json({ 
        error: 'Invalid or expired token',
        details: err.message
      });
    }

    // Add user info to request
    req.user = extractUserInfo(decoded);
    next();
  });
};

// Optional authentication (for endpoints that work with or without auth)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, getKey, {
    audience: KEYCLOAK_CLIENT_ID,
    issuer: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
    algorithms: ['RS256']
  }, (err, decoded) => {
    if (err) {
      req.user = null;
    } else {
      req.user = extractUserInfo(decoded);
    }
    next();
  });
};

// Admin role check
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!req.user.roles.includes('admin') && !req.user.roles.includes('task-manager-admin')) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }

  next();
};

// User ownership check
const requireOwnership = async (pool, table = 'task_lists') => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const resourceId = req.params.listId || req.params.taskId || req.params.templateId;
      
      if (!resourceId) {
        return next(); // No resource to check ownership for
      }

      let query;
      switch (table) {
        case 'task_lists':
          query = 'SELECT user_id FROM task_lists WHERE id = $1';
          break;
        case 'task_templates':
          query = 'SELECT tl.user_id FROM task_templates tt JOIN task_lists tl ON tt.list_id = tl.id WHERE tt.id = $1';
          break;
        case 'tasks':
          query = 'SELECT tl.user_id FROM tasks t JOIN task_lists tl ON t.list_id = tl.id WHERE t.id = $1';
          break;
        default:
          return res.status(500).json({ error: 'Invalid ownership check configuration' });
      }

      const result = await pool.query(query, [resourceId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      if (result.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied: You can only access your own resources' });
      }

      next();
    } catch (error) {
      console.error('Ownership check failed:', error);
      res.status(500).json({ error: 'Failed to verify resource ownership' });
    }
  };
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
  requireOwnership,
  extractUserInfo
};