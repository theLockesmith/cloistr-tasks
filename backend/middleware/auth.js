// middleware/auth.js - Nostr authentication with JWT sessions
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

// Known-compromised secrets that were committed to the repository.
// The server must refuse to start on any of these.
const COMMITTED_SECRETS = [
  'cloistr-tasks-jwt-secret-change-in-production',
  'cloistr-dev-secret-change-in-production',
];

if (!process.env.JWT_SECRET) {
  console.error(
    'FATAL: JWT_SECRET is not set. The server will not start without it.\n' +
    'Set JWT_SECRET in the environment or in a .env file that is NOT committed to git.'
  );
  process.exit(1);
}

if (COMMITTED_SECRETS.includes(process.env.JWT_SECRET)) {
  console.error(
    'FATAL: JWT_SECRET is set to a known placeholder that was committed to the repository.\n' +
    'Generate a real secret (e.g. `openssl rand -base64 32`) and set it in an untracked .env file.'
  );
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Verify JWT token and extract user info
function verifyJWT(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      id: decoded.pubkey, // Use pubkey as user ID
      pubkey: decoded.pubkey,
      username: decoded.username || null,
      email: decoded.email || null,
      firstName: decoded.firstName || null,
      lastName: decoded.lastName || null,
      roles: decoded.roles || []
    };
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return null;
  }
}

// Issue a new JWT for authenticated user
function issueJWT(pubkey, additionalClaims = {}) {
  const payload = {
    pubkey,
    ...additionalClaims,
    iat: Math.floor(Date.now() / 1000)
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  // Calculate expiration timestamp
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();

  return {
    token,
    expiresAt,
    expiresIn: decoded.exp - decoded.iat
  };
}

// Authentication middleware - validates JWT and sets req.user
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        action: 'login_required'
      });
    }

    // Verify JWT
    const user = verifyJWT(token);

    if (!user) {
      return res.status(403).json({
        error: 'Invalid or expired token',
        action: 'login_required'
      });
    }

    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(403).json({
      error: 'Token verification failed',
      details: error.message
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

    // Verify JWT
    const user = verifyJWT(token);
    req.user = user; // Will be null if verification failed

    next();
  } catch (error) {
    console.error('Optional auth error:', error);
    req.user = null;
    next();
  }
};

// Ownership middleware - ensures user owns the resource
// Note: This requires pool to be passed as parameter since we can't use dynamic import in middleware
const requireOwnership = (pool) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

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

export {
  authenticateToken,
  optionalAuth,
  requireOwnership,
  verifyJWT,
  issueJWT,
  JWT_SECRET,
  JWT_EXPIRES_IN
};
