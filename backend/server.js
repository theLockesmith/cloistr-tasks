// backend/server.js - Task Manager Backend with Nostr Authentication
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import dotenv from 'dotenv';
import promClient from 'prom-client';

import { initializeDatabase, createPool, createAppPool } from './database/init.js';
import { emptyToNull, toIntOrNull } from './utils.js';
import { authenticateToken, optionalAuth, issueJWT } from './middleware/auth.js';
import { listAccess, hasAccess, templateAccess, taskAccess, cardAccess } from './lib/access.js';

// Import nostr-tools for signature verification
import { verifyEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

dotenv.config();

// ── Field-length validation ────────────────────────────────────────────────
// Generous caps for the TEXT columns (8192 clears any realistic NIP-44 sealed
// value).  Labels use 2000 to stay safely under the btree page limit on the
// UNIQUE(user_id, name) index.
const FIELD_LIMITS = { name: 8192, title: 8192, label_name: 2000 };

function fieldTooLong(value, field, limit) {
  if (value != null && String(value).length > limit) {
    return {
      error: `${field} exceeds maximum length of ${limit} characters`,
      field,
      limit,
      actual: String(value).length,
    };
  }
  return null;
}

const app = express();
const port = process.env.PORT || 3000;

// Global database pool
let pool;

// Prometheus metrics setup
const register = new promClient.Registry();
register.setDefaultLabels({ app: 'cloistr-tasks-backend' });
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});
register.registerMetric(httpRequestDuration);

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestsTotal);

const activeConnections = new promClient.Gauge({
  name: 'http_active_connections',
  help: 'Number of active HTTP connections'
});
register.registerMetric(activeConnections);

const dbQueryDuration = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});
register.registerMetric(dbQueryDuration);

// Middleware to track metrics
const metricsMiddleware = (req, res, next) => {
  // Skip metrics endpoint itself
  if (req.path === '/metrics') {
    return next();
  }

  activeConnections.inc();
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    activeConnections.dec();
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route: route,
      status_code: res.statusCode
    };
    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });

  next();
};

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(metricsMiddleware);

// User sync/creation function for Nostr users
async function syncUser(userInfo) {
  try {
    const pubkey = userInfo.pubkey || userInfo.id;
    console.log('Syncing Nostr user:', pubkey);

    // Upsert user using pubkey as primary identifier
    await pool.query(`
      INSERT INTO users (id, pubkey, email, username, first_name, last_name, last_login)
      VALUES ($1, $1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO UPDATE SET
        pubkey = COALESCE(EXCLUDED.pubkey, users.pubkey),
        email = COALESCE(EXCLUDED.email, users.email),
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        last_login = NOW(),
        updated_at = NOW()
    `, [pubkey, userInfo.email || null, userInfo.username || null, userInfo.firstName || null, userInfo.lastName || null]);

    // Create default user settings if they don't exist
    await pool.query(`
      INSERT INTO user_settings (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING
    `, [pubkey]);

    return true;
  } catch (error) {
    console.error('Error syncing user:', error);
    return false;
  }
}

// Format pubkey as npub for display
function formatPubkeyAsNpub(pubkey) {
  try {
    return nip19.npubEncode(pubkey);
  } catch (error) {
    return pubkey.substring(0, 8) + '...' + pubkey.substring(pubkey.length - 4);
  }
}

// Initialize database and start server
async function startServer() {
  try {
    console.log('🚀 Starting Task Manager API...');
    
    // Initialize database
    await initializeDatabase();
    
    // Create database connection pool
    pool = createAppPool();
    
    console.log('✅ Database connection established');
    
    // Start the server
    app.listen(port, () => {
      console.log(`🎉 Task Manager API running on port ${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`🔐 Auth: Nostr (NIP-07/NIP-46)`);
    });
    
  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
}

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      auth: 'nostr'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// Nostr auth configuration endpoint (for frontend)
app.get('/api/auth/config', (req, res) => {
  res.json({
    auth_type: 'nostr',
    supported_nips: ['NIP-07', 'NIP-46'],
    challenge_endpoint: '/api/auth/challenge',
    verify_endpoint: '/api/auth/verify'
  });
});

// Generate authentication challenge
app.get('/api/auth/challenge', async (req, res) => {
  try {
    // Generate random challenge
    const challenge = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store challenge in database
    await pool.query(`
      INSERT INTO auth_challenges (challenge, nonce, expires_at)
      VALUES ($1, $2, $3)
    `, [challenge, nonce, expiresAt]);

    // Clean up old challenges
    await pool.query(`
      DELETE FROM auth_challenges
      WHERE expires_at < NOW() OR (used = true AND used_at < NOW() - INTERVAL '1 hour')
    `);

    res.json({
      challenge,
      nonce,
      expires_at: expiresAt.toISOString()
    });
  } catch (error) {
    console.error('Error generating challenge:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Verify signed Nostr event and issue JWT
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { signedEvent } = req.body;

    if (!signedEvent) {
      return res.status(400).json({ error: 'Signed event required' });
    }

    // Validate event structure
    if (!signedEvent.pubkey || !signedEvent.sig || !signedEvent.content) {
      return res.status(400).json({ error: 'Invalid event structure' });
    }

    // Verify Nostr signature
    const isValidSignature = verifyEvent(signedEvent);
    if (!isValidSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse challenge from event content
    let challengeData;
    try {
      challengeData = JSON.parse(signedEvent.content);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid challenge format' });
    }

    const { challenge, nonce } = challengeData;

    if (!challenge || !nonce) {
      return res.status(400).json({ error: 'Missing challenge or nonce' });
    }

    // Verify challenge exists and is valid
    const challengeResult = await pool.query(`
      SELECT * FROM auth_challenges
      WHERE challenge = $1 AND nonce = $2 AND used = false AND expires_at > NOW()
    `, [challenge, nonce]);

    if (challengeResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired challenge' });
    }

    // Mark challenge as used
    await pool.query(`
      UPDATE auth_challenges
      SET used = true, used_by = $1, used_at = NOW()
      WHERE challenge = $2
    `, [signedEvent.pubkey, challenge]);

    // Create or update user
    const userInfo = {
      pubkey: signedEvent.pubkey,
      id: signedEvent.pubkey
    };

    const synced = await syncUser(userInfo);
    if (!synced) {
      return res.status(500).json({ error: 'Failed to sync user data' });
    }

    // Issue JWT
    const { token, expiresAt, expiresIn } = issueJWT(signedEvent.pubkey);

    console.log('Nostr auth successful for pubkey:', signedEvent.pubkey.substring(0, 8) + '...');

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      expires_at: expiresAt,
      user: {
        id: signedEvent.pubkey,
        pubkey: signedEvent.pubkey,
        npub: formatPubkeyAsNpub(signedEvent.pubkey)
      },
      message: 'Authentication successful'
    });

  } catch (error) {
    console.error('Nostr auth verification error:', error);
    res.status(500).json({
      error: 'Internal server error during verification',
      details: error.message
    });
  }
});

// Token refresh endpoint (re-issue JWT)
app.post('/api/auth/refresh', authenticateToken, async (req, res) => {
  try {
    // User is already authenticated via middleware
    const { token, expiresAt, expiresIn } = issueJWT(req.user.pubkey, {
      username: req.user.username,
      email: req.user.email
    });

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      expires_at: expiresAt,
      message: 'Token refreshed successfully'
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Internal server error during token refresh',
      details: error.message
    });
  }
});

// Token info endpoint
app.get('/api/auth/token-info', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: {
        ...req.user,
        npub: formatPubkeyAsNpub(req.user.pubkey)
      },
      token_valid: true,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get token info' });
  }
});

// Get current user profile and settings
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    await syncUser(req.user);

    const result = await pool.query(`
      SELECT u.*, us.* FROM users u
      LEFT JOIN user_settings us ON u.id = us.user_id
      WHERE u.id = $1
    `, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Update user settings
app.put('/api/user/settings', authenticateToken, async (req, res) => {
  try {
    await syncUser(req.user);
    
    const {
      reset_enabled,
      reset_time,
      reset_timezone,
      reset_days,
      custom_reset_days,
      auto_create_tasks,
      theme,
      notification_email,
      notification_browser
    } = req.body;

    const result = await pool.query(`
      UPDATE user_settings SET
        reset_enabled = COALESCE($2, reset_enabled),
        reset_time = COALESCE($3, reset_time),
        reset_timezone = COALESCE($4, reset_timezone),
        reset_days = COALESCE($5, reset_days),
        custom_reset_days = COALESCE($6, custom_reset_days),
        auto_create_tasks = COALESCE($7, auto_create_tasks),
        theme = COALESCE($8, theme),
        notification_email = COALESCE($9, notification_email),
        notification_browser = COALESCE($10, notification_browser),
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `, [
      req.user.id, reset_enabled, reset_time, reset_timezone, reset_days,
      custom_reset_days, auto_create_tasks, theme, notification_email, notification_browser
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({ error: 'Failed to update user settings' });
  }
});

// Get all task lists (owned + shared with this user)
app.get('/api/lists', authenticateToken, async (req, res) => {
  try {
    await syncUser(req.user);

    const result = await pool.query(`
      SELECT l.*,
             COUNT(t.id) as total_tasks,
             COUNT(CASE WHEN t.completed_at IS NOT NULL THEN 1 END) as completed_tasks,
             CASE WHEN l.user_id = $1 THEN 'owner'
                  ELSE tls.permission
             END AS access
      FROM task_lists l
      LEFT JOIN task_list_shares tls ON tls.list_id = l.id AND tls.pubkey = $1
      LEFT JOIN tasks t ON l.id = t.list_id AND DATE(t.reset_date) = CURRENT_DATE
      WHERE (l.user_id = $1 OR tls.pubkey IS NOT NULL) AND l.active = true
      GROUP BY l.id, tls.permission
      ORDER BY l.sort_order, l.name
    `, [req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching lists:', error);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

// Get tasks for a specific list (any access level)
app.get('/api/lists/:listId/tasks', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }

    const result = await pool.query(`
      SELECT t.*,
             tt.name          AS template_name,
             tt.description   AS template_description,
             tt.time_slot,
             tt.estimated_minutes,
             tt.priority,
             tt.due_date,
             tt.parent_template_id,
             tt.reminder_offset_minutes,
             COALESCE(
               (SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color))
                FROM task_template_labels ttl
                JOIN labels l ON l.id = ttl.label_id
                WHERE ttl.template_id = tt.id),
               '[]'::json
             ) AS labels,
             (SELECT COUNT(*) FROM task_templates sub
              WHERE sub.parent_template_id = tt.id AND sub.active = true) AS subtask_count
      FROM tasks t
      JOIN task_templates tt ON t.template_id = tt.id
      WHERE t.list_id = $1 AND DATE(t.reset_date) = $2
        AND tt.parent_template_id IS NULL
      ORDER BY tt.sort_order, tt.name
    `, [listId, today]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Toggle task completion (requires write access)
app.post('/api/tasks/:taskId/toggle', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;

    const { access } = await taskAccess(pool, taskId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (!hasAccess(access, 'write')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(`
      UPDATE tasks
      SET completed_at = CASE
        WHEN completed_at IS NULL THEN NOW()
        ELSE NULL
      END,
      updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [taskId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error toggling task:', error);
    res.status(500).json({ error: 'Failed to toggle task' });
  }
});

// emptyToNull and toIntOrNull imported from ./utils.js

// Create new task list (user-specific)
app.post('/api/lists', authenticateToken, async (req, res) => {
  try {
    await syncUser(req.user);

    const {
      name, description, icon, color,
      list_type, reset_enabled, reset_time, reset_days, custom_reset_days,
    } = req.body;

    const nameErr = fieldTooLong(name, 'name', FIELD_LIMITS.name);
    if (nameErr) return res.status(400).json(nameErr);

    // First, get the next sort order for this user
    const sortResult = await pool.query(`
      SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort_order
      FROM task_lists
      WHERE user_id = $1
    `, [req.user.id]);

    const nextSortOrder = sortResult.rows[0].next_sort_order;

    // Then insert the new list, persisting all recurrence configuration.
    const result = await pool.query(`
      INSERT INTO task_lists (
        name, description, icon, color, user_id, sort_order,
        list_type, reset_enabled, reset_time, reset_days, custom_reset_days
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      name,
      description,
      icon || '📋',
      color || '#3b82f6',
      req.user.id,
      nextSortOrder,
      list_type || 'recurring',
      reset_enabled !== false,
      emptyToNull(reset_time) || '06:00',
      reset_days || 'daily',
      Array.isArray(custom_reset_days) ? custom_reset_days : [],
    ]);

    const newList = { ...result.rows[0], access: 'owner' };

    // When creating a board, seed default columns so a write grantee (the
    // fleet bridge) can place cards immediately without needing owner-level
    // column creation.  The owner can rename/reorder/delete these later.
    if ((list_type || 'recurring') === 'board') {
      const defaultColumns = ['To Do', 'In Progress', 'Done'];
      for (let i = 0; i < defaultColumns.length; i++) {
        await pool.query(
          'INSERT INTO board_columns (list_id, name, sort_order) VALUES ($1, $2, $3)',
          [newList.id, defaultColumns[i], i + 1],
        );
      }
    }

    res.status(201).json(newList);
  } catch (error) {
    console.error('Error creating list:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

// Update a task list - name, appearance and recurrence settings (owner only).
app.put('/api/lists/:listId', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const {
      name, description, icon, color, sortOrder, visibility,
      list_type, reset_enabled, reset_time, reset_days, custom_reset_days,
    } = req.body;

    if (name !== undefined) {
      const nameErr = fieldTooLong(name, 'name', FIELD_LIMITS.name);
      if (nameErr) return res.status(400).json(nameErr);
    }

    if (visibility !== undefined && !['private', 'public'].includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be "private" or "public"' });
    }

    if (visibility === 'public') {
      const typeCheck = await pool.query('SELECT list_type FROM task_lists WHERE id = $1', [listId]);
      if (typeCheck.rows[0]?.list_type !== 'board') {
        return res.status(400).json({ error: 'Only boards can be made public' });
      }
    }

    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!hasAccess(access, 'admin')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Visibility changes (public/private) are owner-only.
    if (visibility !== undefined && access !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can change board visibility' });
    }

    // COALESCE keeps existing values for fields the caller did not supply.
    // Access was already verified above via listAccess(); the WHERE keys on
    // id alone so admins (who are not user_id) can update the row.
    const result = await pool.query(`
      UPDATE task_lists
      SET name               = COALESCE($1, name),
          description        = COALESCE($2, description),
          icon               = COALESCE($3, icon),
          color              = COALESCE($4, color),
          sort_order         = COALESCE($5, sort_order),
          list_type          = COALESCE($6, list_type),
          reset_enabled      = COALESCE($7, reset_enabled),
          reset_time         = COALESCE($8, reset_time),
          reset_days         = COALESCE($9, reset_days),
          custom_reset_days  = COALESCE($10, custom_reset_days),
          visibility         = COALESCE($12, visibility)
      WHERE id = $11
      RETURNING *
    `, [
      name === undefined || name === '' ? null : String(name).trim(),
      emptyToNull(description),
      emptyToNull(icon),
      emptyToNull(color),
      toIntOrNull(sortOrder),
      emptyToNull(list_type),
      reset_enabled === undefined ? null : Boolean(reset_enabled),
      emptyToNull(reset_time),
      emptyToNull(reset_days),
      Array.isArray(custom_reset_days) ? custom_reset_days : (custom_reset_days === undefined ? null : []),
      listId,
      emptyToNull(visibility),
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task list:', error);
    res.status(500).json({ error: 'Failed to update task list' });
  }
});

// Delete a task list along with all its templates and task instances (owner only).
app.delete('/api/lists/:listId', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;

    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!hasAccess(access, 'owner')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete in dependency order inside a transaction so a failure cannot
    // leave orphaned rows.  Shares are CASCADE-deleted by the FK.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM tasks WHERE list_id = $1', [listId]);
      await client.query('DELETE FROM task_templates WHERE list_id = $1', [listId]);
      await client.query('DELETE FROM task_lists WHERE id = $1', [listId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting task list:', error);
    res.status(500).json({ error: 'Failed to delete task list' });
  }
});

app.post('/api/lists/:listId/templates', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const {
      name, description, timeSlot, estimatedMinutes, priority, dueDate,
      parentTemplateId, reminderOffsetMinutes, labelIds,
    } = req.body;

    // Validate before touching the database. Cheaper, and an invalid request
    // should not cost a query.
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Task name is required' });
    }
    const nameErr = fieldTooLong(name, 'name', FIELD_LIMITS.name);
    if (nameErr) return res.status(400).json(nameErr);

    // Access check: creating templates requires write access.
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!hasAccess(access, 'write')) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // list_type is needed below for completion-list logic.
    const listTypeResult = await pool.query(
      'SELECT list_type FROM task_lists WHERE id = $1',
      [listId]
    );
    const listType = listTypeResult.rows[0]?.list_type || 'recurring';

    // Validate parent template (if provided): it must belong to the same list
    // and must itself be a top-level template (no two-level nesting).
    if (parentTemplateId) {
      const parentCheck = await pool.query(
        'SELECT id, parent_template_id FROM task_templates WHERE id = $1 AND list_id = $2',
        [parentTemplateId, listId]
      );
      if (parentCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Parent task not found in this list' });
      }
      if (parentCheck.rows[0].parent_template_id !== null) {
        return res.status(400).json({ error: 'Cannot nest a sub-task under another sub-task' });
      }
    }

    // Create the template
    const templateResult = await pool.query(`
      INSERT INTO task_templates (
        list_id, name, description, time_slot, estimated_minutes,
        priority, due_date, parent_template_id, reminder_offset_minutes,
        sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, (
        SELECT COALESCE(MAX(sort_order), 0) + 1
        FROM task_templates
        WHERE list_id = $1
      ))
      RETURNING *
    `, [
      listId,
      String(name).trim(),
      emptyToNull(description),
      emptyToNull(timeSlot),
      toIntOrNull(estimatedMinutes),
      priority || 'medium',
      emptyToNull(dueDate),
      toIntOrNull(parentTemplateId),
      toIntOrNull(reminderOffsetMinutes),
    ]);

    const newTemplate = templateResult.rows[0];

    // For completion lists: only create today's task instance if the template
    // has not already been completed on any previous day.
    // For recurring lists: always create the instance (ON CONFLICT DO NOTHING
    // handles duplicate-day safety).
    const shouldCreate = listType !== 'completion' || !(await pool.query(
      `SELECT 1 FROM tasks WHERE template_id = $1 AND completed_at IS NOT NULL AND DATE(reset_date) < CURRENT_DATE LIMIT 1`,
      [newTemplate.id]
    )).rows.length;

    if (shouldCreate) {
      await pool.query(`
        INSERT INTO tasks (template_id, list_id, reset_date, created_at)
        VALUES ($1, $2, CURRENT_DATE, NOW())
        ON CONFLICT (template_id, reset_date) DO NOTHING
      `, [newTemplate.id, listId]);
    }

    // Attach labels if provided (ignore unknown label IDs silently).
    if (Array.isArray(labelIds) && labelIds.length > 0) {
      const validLabelIds = labelIds.map(toIntOrNull).filter(Boolean);
      if (validLabelIds.length > 0) {
        const labelPlaceholders = validLabelIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await pool.query(
          `INSERT INTO task_template_labels (template_id, label_id)
           VALUES ${labelPlaceholders}
           ON CONFLICT DO NOTHING`,
          [newTemplate.id, ...validLabelIds]
        );
      }
    }

    console.log(`Created template ${newTemplate.id}, task instance created=${shouldCreate}`);

    res.status(201).json(newTemplate);
  } catch (error) {
    console.error('Error creating task template:', error);
    res.status(500).json({ error: 'Failed to create task template' });
  }
});

// Update task template (requires write access)
app.put('/api/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const { templateId } = req.params;
    const {
      name, description, timeSlot, estimatedMinutes, priority, dueDate,
      sort_order, reminderOffsetMinutes, labelIds,
    } = req.body;

    if (name !== undefined) {
      const nameErr = fieldTooLong(name, 'name', FIELD_LIMITS.name);
      if (nameErr) return res.status(400).json(nameErr);
    }

    const { access } = await templateAccess(pool, templateId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (!hasAccess(access, 'write')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build dynamic update query based on provided fields
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${paramIndex++}`); values.push(description); }
    if (timeSlot !== undefined) { updates.push(`time_slot = $${paramIndex++}`); values.push(timeSlot); }
    if (estimatedMinutes !== undefined) { updates.push(`estimated_minutes = $${paramIndex++}`); values.push(estimatedMinutes); }
    if (priority !== undefined) { updates.push(`priority = $${paramIndex++}`); values.push(priority); }
    if (dueDate !== undefined) { updates.push(`due_date = $${paramIndex++}`); values.push(dueDate || null); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${paramIndex++}`); values.push(sort_order); }
    if (reminderOffsetMinutes !== undefined) {
      updates.push(`reminder_offset_minutes = $${paramIndex++}`);
      values.push(toIntOrNull(reminderOffsetMinutes));
    }

    updates.push('updated_at = NOW()');
    values.push(templateId);

    const result = await pool.query(`
      UPDATE task_templates
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex++}
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Sync labels if provided: replace the full set atomically.
    if (Array.isArray(labelIds)) {
      await pool.query('DELETE FROM task_template_labels WHERE template_id = $1', [templateId]);
      const validLabelIds = labelIds.map(toIntOrNull).filter(Boolean);
      if (validLabelIds.length > 0) {
        const labelPlaceholders = validLabelIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await pool.query(
          `INSERT INTO task_template_labels (template_id, label_id)
           VALUES ${labelPlaceholders}
           ON CONFLICT DO NOTHING`,
          [templateId, ...validLabelIds]
        );
      }
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete task template (requires write access)
app.delete('/api/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const { templateId } = req.params;

    const { access } = await templateAccess(pool, templateId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (!hasAccess(access, 'write')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'DELETE FROM task_templates WHERE id = $1 RETURNING id',
      [templateId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Manual reset for user
app.post('/api/user/reset', authenticateToken, async (req, res) => {
  try {
    await syncUser(req.user);
    
    const result = await pool.query('SELECT create_user_tasks_for_today($1) as tasks_created', [req.user.id]);
    
    res.json({ 
      message: 'Manual reset completed', 
      tasksCreated: result.rows[0].tasks_created,
      date: new Date().toISOString().split('T')[0]
    });
  } catch (error) {
    console.error('Error during manual reset:', error);
    res.status(500).json({ error: 'Failed to complete manual reset' });
  }
});

// Admin-only: Global daily reset
app.post('/api/admin/reset-daily', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.roles.includes('admin') && !req.user.roles.includes('task-manager-admin')) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }

    const result = await pool.query(`
      SELECT user_id, create_user_tasks_for_today(user_id) as tasks_created
      FROM users 
      WHERE id IN (
        SELECT user_id FROM user_settings WHERE reset_enabled = true
      )
    `);
    
    const totalTasks = result.rows.reduce((sum, row) => sum + parseInt(row.tasks_created), 0);
    
    res.json({ 
      message: 'Global daily reset completed', 
      usersProcessed: result.rows.length,
      totalTasksCreated: totalTasks,
      date: new Date().toISOString().split('T')[0]
    });
  } catch (error) {
    console.error('Error during global daily reset:', error);
    res.status(500).json({ error: 'Failed to complete global daily reset' });
  }
});

// Get user analytics (owned lists only — shared lists are excluded).
app.get('/api/user/analytics', authenticateToken, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysInt = parseInt(days, 10);
    if (!Number.isFinite(daysInt) || daysInt < 1) {
      return res.status(400).json({ error: 'days must be a positive integer' });
    }

    const result = await pool.query(`
      SELECT
        DATE(t.reset_date) as date,
        tl.name as list_name,
        tl.icon,
        COUNT(t.id) as total_tasks,
        COUNT(t.completed_at) as completed_tasks,
        ROUND(COUNT(t.completed_at) * 100.0 / COUNT(t.id), 1) as completion_percentage
      FROM tasks t
      JOIN task_lists tl ON t.list_id = tl.id
      WHERE tl.user_id = $1
      AND t.reset_date >= CURRENT_DATE - ($2 * INTERVAL '1 day')
      GROUP BY DATE(t.reset_date), tl.id, tl.name, tl.icon
      ORDER BY date DESC, tl.sort_order
    `, [req.user.id, daysInt]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get reset history for user
app.get('/api/user/reset-history', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const result = await pool.query(`
      SELECT rh.*, tl.name as list_name, tl.icon
      FROM reset_history rh
      LEFT JOIN task_lists tl ON rh.list_id = tl.id
      WHERE rh.user_id = $1
      ORDER BY rh.reset_time DESC
      LIMIT $2
    `, [req.user.id, parseInt(limit)]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reset history:', error);
    res.status(500).json({ error: 'Failed to fetch reset history' });
  }
});

// ── Labels (tags) ─────────────────────────────────────────────────────────────

// List all labels for the current user.
app.get('/api/labels', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM labels WHERE user_id = $1 ORDER BY name',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching labels:', error);
    res.status(500).json({ error: 'Failed to fetch labels' });
  }
});

// Create a label.
app.post('/api/labels', authenticateToken, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Label name is required' });
    }
    const labelNameErr = fieldTooLong(name, 'name', FIELD_LIMITS.label_name);
    if (labelNameErr) return res.status(400).json(labelNameErr);

    const result = await pool.query(
      `INSERT INTO labels (user_id, name, color) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name) DO UPDATE SET color = EXCLUDED.color
       RETURNING *`,
      [req.user.id, String(name).trim(), color || '#6366f1']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating label:', error);
    res.status(500).json({ error: 'Failed to create label' });
  }
});

// Update a label (name and/or color).
app.put('/api/labels/:labelId', authenticateToken, async (req, res) => {
  try {
    const { labelId } = req.params;
    const { name, color } = req.body;

    if (name !== undefined) {
      const labelNameErr = fieldTooLong(name, 'name', FIELD_LIMITS.label_name);
      if (labelNameErr) return res.status(400).json(labelNameErr);
    }

    const result = await pool.query(
      `UPDATE labels
       SET name  = COALESCE($1, name),
           color = COALESCE($2, color)
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [
        name ? String(name).trim() : null,
        color || null,
        labelId,
        req.user.id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating label:', error);
    res.status(500).json({ error: 'Failed to update label' });
  }
});

// Delete a label (cascades junction rows via FK).
app.delete('/api/labels/:labelId', authenticateToken, async (req, res) => {
  try {
    const { labelId } = req.params;
    const result = await pool.query(
      'DELETE FROM labels WHERE id = $1 AND user_id = $2 RETURNING id',
      [labelId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Label not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting label:', error);
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

// Get sub-tasks for a given template (any access level).
app.get('/api/templates/:templateId/subtasks', authenticateToken, async (req, res) => {
  try {
    const { templateId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const { access } = await templateAccess(pool, templateId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Return sub-task templates alongside today's task instance if it exists.
    const result = await pool.query(`
      SELECT tt.*,
             t.id         AS task_id,
             t.completed_at,
             t.reset_date
      FROM task_templates tt
      LEFT JOIN tasks t ON t.template_id = tt.id AND DATE(t.reset_date) = $2
      WHERE tt.parent_template_id = $1
        AND tt.active = true
      ORDER BY tt.sort_order, tt.name
    `, [templateId, today]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subtasks:', error);
    res.status(500).json({ error: 'Failed to fetch subtasks' });
  }
});


// ── List sharing ─────────────────────────────────────────────────────────────

// List shares for a list (admin or owner).
app.get('/api/lists/:listId/shares', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!hasAccess(access, 'admin')) {
      return res.status(403).json({ error: 'Admin access required to view shares' });
    }

    const result = await pool.query(
      'SELECT id, pubkey, permission, created_at FROM task_list_shares WHERE list_id = $1 ORDER BY created_at',
      [listId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching shares:', error);
    res.status(500).json({ error: 'Failed to fetch shares' });
  }
});

// Share a list with a pubkey (admin or owner).
app.post('/api/lists/:listId/shares', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const { pubkey, permission } = req.body;

    if (!/^[0-9a-f]{64}$/.test(pubkey)) {
      return res.status(400).json({ error: 'A valid 64-character hex pubkey is required' });
    }
    if (permission && !['read', 'write', 'admin'].includes(permission)) {
      return res.status(400).json({ error: 'Permission must be "read", "write", or "admin"' });
    }
    if (pubkey === req.user.id) {
      return res.status(400).json({ error: 'Cannot share a list with yourself' });
    }

    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!hasAccess(access, 'admin')) {
      return res.status(403).json({ error: 'Admin access required to share this list' });
    }

    // Granting 'admin' level is owner-only — prevents the admin set from
    // being self-expanding.
    if (permission === 'admin' && access !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can grant admin access' });
    }

    const result = await pool.query(`
      INSERT INTO task_list_shares (list_id, pubkey, permission)
      VALUES ($1, $2, $3)
      ON CONFLICT (list_id, pubkey) DO UPDATE SET permission = EXCLUDED.permission
      RETURNING *
    `, [listId, pubkey, permission || 'read']);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error sharing list:', error);
    res.status(500).json({ error: 'Failed to share list' });
  }
});

// Remove a share (admin or owner).
app.delete('/api/lists/:listId/shares/:pubkey', authenticateToken, async (req, res) => {
  try {
    const { listId, pubkey } = req.params;

    if (!/^[0-9a-f]{64}$/.test(pubkey)) {
      return res.status(400).json({ error: 'A valid 64-character hex pubkey is required' });
    }

    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!hasAccess(access, 'admin')) {
      return res.status(403).json({ error: 'Admin access required to remove shares' });
    }

    // Removing an admin share is owner-only — prevents admins from demoting
    // each other.  Exception: an admin may resign their OWN admin grant.
    const targetShare = await pool.query(
      'SELECT permission FROM task_list_shares WHERE list_id = $1 AND pubkey = $2',
      [listId, pubkey]
    );
    if (targetShare.rows.length > 0 && targetShare.rows[0].permission === 'admin'
        && access !== 'owner' && pubkey !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can remove admin shares' });
    }

    const result = await pool.query(
      'DELETE FROM task_list_shares WHERE list_id = $1 AND pubkey = $2 RETURNING id',
      [listId, pubkey]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Share not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error removing share:', error);
    res.status(500).json({ error: 'Failed to remove share' });
  }
});

// Transfer ownership of a list (owner only).
// Moves task_lists.user_id to a pubkey that already holds a share.
// Demotes the previous owner to admin rather than dropping them.
app.post('/api/lists/:listId/transfer', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const { pubkey } = req.body;

    if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) {
      return res.status(400).json({ error: 'A valid 64-character hex pubkey is required' });
    }
    if (pubkey === req.user.id) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }

    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (!hasAccess(access, 'owner')) {
      return res.status(403).json({ error: 'Only the owner can transfer ownership' });
    }

    // The target must already have a share on this list.
    const shareCheck = await pool.query(
      'SELECT id FROM task_list_shares WHERE list_id = $1 AND pubkey = $2',
      [listId, pubkey]
    );
    if (shareCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Target must already have a share on this list' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Remove the target's share row (they become the owner, so the row is redundant).
      await client.query(
        'DELETE FROM task_list_shares WHERE list_id = $1 AND pubkey = $2',
        [listId, pubkey]
      );

      // Demote the previous owner to admin.
      await client.query(`
        INSERT INTO task_list_shares (list_id, pubkey, permission)
        VALUES ($1, $2, 'admin')
        ON CONFLICT (list_id, pubkey) DO UPDATE SET permission = 'admin'
      `, [listId, req.user.id]);

      // Transfer ownership.
      await client.query(
        'UPDATE task_lists SET user_id = $1 WHERE id = $2',
        [pubkey, listId]
      );

      await client.query('COMMIT');

      // Return the list with the caller's new access level (admin).
      const result = await pool.query(`
        SELECT l.*,
               CASE WHEN l.user_id = $1 THEN 'owner'
                    ELSE tls.permission
               END AS access
        FROM task_lists l
        LEFT JOIN task_list_shares tls ON tls.list_id = l.id AND tls.pubkey = $1
        WHERE l.id = $2
      `, [req.user.id, listId]);
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  }
});

// ── Board endpoints ─────────────────────────────────────────────────────
//
// Boards are task_lists with list_type = 'board'.  They reuse the existing
// access control:  listAccess() for list-level checks, cardAccess() for
// card-level checks.
//
// Permission model:
//   owner  → full control (columns, cards, comments, board settings)
//   write  → create/move cards, post comments, edit/delete own comments
//   read   → view everything

// Get full board (columns + cards, one call)
app.get('/api/boards/:listId', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const [colResult, cardResult] = await Promise.all([
      pool.query(`
        SELECT id, name, color, sort_order, collapsed
        FROM board_columns
        WHERE list_id = $1
        ORDER BY sort_order, id
      `, [listId]),
      pool.query(`
        SELECT id, column_id, title, description, priority, due_date,
               author_pubkey, assignee_pubkey, sort_order,
               external_id, external_source, created_at, updated_at
        FROM board_cards
        WHERE list_id = $1
        ORDER BY sort_order, id
      `, [listId]),
    ]);

    // Group cards under their column for a single-call board reconstruction.
    const cardsByColumn = {};
    for (const card of cardResult.rows) {
      if (!cardsByColumn[card.column_id]) cardsByColumn[card.column_id] = [];
      cardsByColumn[card.column_id].push(card);
    }

    const columns = colResult.rows.map(col => ({
      ...col,
      cards: cardsByColumn[col.id] || [],
    }));

    res.json({ columns, access });
  } catch (error) {
    console.error('Error fetching board:', error);
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// ── Board columns (owner-only CUD) ─────────────────────────────────────

app.post('/api/boards/:listId/columns', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Board not found' });
    if (!hasAccess(access, 'admin')) return res.status(403).json({ error: 'Column creation requires admin access' });

    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Column name is required' });
    const nameErr = fieldTooLong(name, 'name', FIELD_LIMITS.name);
    if (nameErr) return res.status(400).json(nameErr);

    const sortResult = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM board_columns WHERE list_id = $1',
      [listId],
    );

    const result = await pool.query(`
      INSERT INTO board_columns (list_id, name, color, sort_order)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [listId, name.trim(), emptyToNull(color), sortResult.rows[0].next]);

    res.status(201).json({ ...result.rows[0], access });
  } catch (error) {
    console.error('Error creating column:', error);
    res.status(500).json({ error: 'Failed to create column' });
  }
});

app.put('/api/boards/:listId/columns/:columnId', authenticateToken, async (req, res) => {
  try {
    const { listId, columnId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Board not found' });
    if (!hasAccess(access, 'admin')) return res.status(403).json({ error: 'Column update requires admin access' });

    const { name, color, sortOrder, collapsed } = req.body;

    if (name !== undefined) {
      const nameErr = fieldTooLong(name, 'name', FIELD_LIMITS.name);
      if (nameErr) return res.status(400).json(nameErr);
    }

    const result = await pool.query(`
      UPDATE board_columns
      SET name       = COALESCE($1, name),
          color      = COALESCE($2, color),
          sort_order = COALESCE($3, sort_order),
          collapsed  = COALESCE($4, collapsed)
      WHERE id = $5 AND list_id = $6
      RETURNING *
    `, [
      name === undefined ? null : String(name).trim(),
      emptyToNull(color),
      toIntOrNull(sortOrder),
      collapsed === undefined ? null : Boolean(collapsed),
      columnId,
      listId,
    ]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Column not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating column:', error);
    res.status(500).json({ error: 'Failed to update column' });
  }
});

app.delete('/api/boards/:listId/columns/:columnId', authenticateToken, async (req, res) => {
  try {
    const { listId, columnId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Board not found' });
    if (!hasAccess(access, 'admin')) return res.status(403).json({ error: 'Column deletion requires admin access' });

    const result = await pool.query(
      'DELETE FROM board_columns WHERE id = $1 AND list_id = $2 RETURNING id',
      [columnId, listId],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Column not found' });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting column:', error);
    res.status(500).json({ error: 'Failed to delete column' });
  }
});

// ── Board cards (write access for CUD) ──────────────────────────────────

app.post('/api/boards/:listId/cards', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Board not found' });
    if (!hasAccess(access, 'write')) return res.status(403).json({ error: 'Card creation requires write access' });

    const { columnId, title, description, priority, dueDate,
            assigneePubkey, externalId, externalSource } = req.body;
    if (!columnId) return res.status(400).json({ error: 'columnId is required' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Card title is required' });
    const titleErr = fieldTooLong(title, 'title', FIELD_LIMITS.title);
    if (titleErr) return res.status(400).json(titleErr);

    // Verify column belongs to this board.
    const colCheck = await pool.query(
      'SELECT id FROM board_columns WHERE id = $1 AND list_id = $2',
      [columnId, listId],
    );
    if (colCheck.rows.length === 0) return res.status(400).json({ error: 'Column not found on this board' });

    const sortResult = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM board_cards WHERE column_id = $1',
      [columnId],
    );

    const result = await pool.query(`
      INSERT INTO board_cards (
        column_id, list_id, title, description, priority, due_date,
        author_pubkey, assignee_pubkey, sort_order, external_id, external_source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      columnId, listId, title.trim(), emptyToNull(description),
      toIntOrNull(priority) || 3, emptyToNull(dueDate),
      req.user.id, emptyToNull(assigneePubkey),
      sortResult.rows[0].next,
      emptyToNull(externalId), emptyToNull(externalSource),
    ]);

    res.status(201).json({ ...result.rows[0], access });
  } catch (error) {
    // Handle unique constraint on (external_source, external_id) for idempotency.
    if (error.code === '23505' && error.constraint === 'idx_board_cards_external') {
      const existing = await pool.query(
        'SELECT * FROM board_cards WHERE external_source = $1 AND external_id = $2',
        [req.body.externalSource, req.body.externalId],
      );
      // Re-resolve access for the idempotent response.
      const dup = existing.rows[0];
      const dupAccess = await listAccess(pool, dup.list_id, req.user.id);
      return res.status(200).json({ ...dup, access: dupAccess });
    }
    console.error('Error creating card:', error);
    res.status(500).json({ error: 'Failed to create card' });
  }
});

app.put('/api/boards/:listId/cards/:cardId', authenticateToken, async (req, res) => {
  try {
    const { listId, cardId } = req.params;
    const { access } = await cardAccess(pool, cardId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Card not found' });
    if (!hasAccess(access, 'write')) return res.status(403).json({ error: 'Card update requires write access' });

    const { title, description, priority, dueDate, assigneePubkey, sortOrder } = req.body;

    if (title !== undefined) {
      const titleErr = fieldTooLong(title, 'title', FIELD_LIMITS.title);
      if (titleErr) return res.status(400).json(titleErr);
    }

    const result = await pool.query(`
      UPDATE board_cards
      SET title           = COALESCE($1, title),
          description     = COALESCE($2, description),
          priority        = COALESCE($3, priority),
          due_date        = COALESCE($4, due_date),
          assignee_pubkey = COALESCE($5, assignee_pubkey),
          sort_order      = COALESCE($6, sort_order)
      WHERE id = $7 AND list_id = $8
      RETURNING *
    `, [
      title === undefined ? null : String(title).trim(),
      description === undefined ? null : emptyToNull(description),
      toIntOrNull(priority),
      dueDate === undefined ? null : emptyToNull(dueDate),
      assigneePubkey === undefined ? null : emptyToNull(assigneePubkey),
      toIntOrNull(sortOrder),
      cardId, listId,
    ]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating card:', error);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

// Move a card to a different column (write access)
app.post('/api/boards/:listId/cards/:cardId/move', authenticateToken, async (req, res) => {
  try {
    const { listId, cardId } = req.params;
    const { access } = await cardAccess(pool, cardId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Card not found' });
    if (!hasAccess(access, 'write')) return res.status(403).json({ error: 'Card move requires write access' });

    const { columnId, sortOrder } = req.body;
    if (!columnId) return res.status(400).json({ error: 'columnId is required' });

    // Verify target column belongs to this board.
    const colCheck = await pool.query(
      'SELECT id FROM board_columns WHERE id = $1 AND list_id = $2',
      [columnId, listId],
    );
    if (colCheck.rows.length === 0) return res.status(400).json({ error: 'Target column not found on this board' });

    const newSort = toIntOrNull(sortOrder);
    const sortVal = newSort !== null ? newSort : (
      await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM board_cards WHERE column_id = $1',
        [columnId],
      )
    ).rows[0].next;

    const result = await pool.query(`
      UPDATE board_cards
      SET column_id  = $1,
          sort_order = $2
      WHERE id = $3 AND list_id = $4
      RETURNING *
    `, [columnId, sortVal, cardId, listId]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error moving card:', error);
    res.status(500).json({ error: 'Failed to move card' });
  }
});

app.delete('/api/boards/:listId/cards/:cardId', authenticateToken, async (req, res) => {
  try {
    const { listId, cardId } = req.params;
    const { access } = await cardAccess(pool, cardId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Card not found' });
    if (!hasAccess(access, 'admin')) return res.status(403).json({ error: 'Card deletion requires admin access' });

    const result = await pool.query(
      'DELETE FROM board_cards WHERE id = $1 AND list_id = $2 RETURNING id',
      [cardId, listId],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting card:', error);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// ── Card comments ───────────────────────────────────────────────────────

app.get('/api/boards/:listId/cards/:cardId/comments', authenticateToken, async (req, res) => {
  try {
    const { listId, cardId } = req.params;
    const { access } = await cardAccess(pool, cardId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Card not found' });

    const result = await pool.query(`
      SELECT id, card_id, list_id, author_pubkey, author_label, body,
             parent_comment_id, deleted_at, external_source, external_id,
             created_at, updated_at
      FROM card_comments
      WHERE card_id = $1
      ORDER BY created_at ASC
    `, [cardId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/boards/:listId/cards/:cardId/comments', authenticateToken, async (req, res) => {
  try {
    const { listId, cardId } = req.params;
    const { access } = await cardAccess(pool, cardId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Card not found' });
    if (!hasAccess(access, 'write')) return res.status(403).json({ error: 'Commenting requires write access' });

    const { body, authorLabel, externalSource, externalId } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

    const parentCommentId = toIntOrNull(req.body.parentCommentId);

    // Scope the parent to the same card so threads cannot span boards.
    if (parentCommentId != null) {
      const parentRow = await pool.query(
        'SELECT id FROM card_comments WHERE id = $1 AND card_id = $2',
        [parentCommentId, cardId],
      );
      if (parentRow.rows.length === 0) {
        return res.status(400).json({ error: 'Parent comment not found on this card' });
      }
    }

    const result = await pool.query(`
      INSERT INTO card_comments (card_id, list_id, author_pubkey, author_label, body,
                                  parent_comment_id, external_source, external_id)
      VALUES ($1, (SELECT list_id FROM board_cards WHERE id = $1), $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      cardId, req.user.id, emptyToNull(authorLabel),
      body.trim(), parentCommentId, emptyToNull(externalSource), emptyToNull(externalId),
    ]);

    res.status(201).json({ ...result.rows[0], access });
  } catch (error) {
    // Idempotent: duplicate external comment returns existing, but only
    // if it belongs to this card.  Otherwise 409 (prevents leaking a
    // comment from another board via the global external_source index).
    if (error.code === '23505' && error.constraint === 'idx_card_comments_external') {
      const existing = await pool.query(
        'SELECT * FROM card_comments WHERE external_source = $1 AND external_id = $2 AND card_id = $3',
        [req.body.externalSource, req.body.externalId, req.params.cardId],
      );
      if (existing.rows.length === 0) {
        return res.status(409).json({ error: 'External identifier already in use on another board' });
      }
      return res.status(200).json(existing.rows[0]);
    }
    console.error('Error creating comment:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

app.put('/api/boards/:listId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

    // Only the comment author can edit.
    const result = await pool.query(`
      UPDATE card_comments
      SET body = $1
      WHERE id = $2 AND author_pubkey = $3
      RETURNING *
    `, [body.trim(), commentId, req.user.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

app.delete('/api/boards/:listId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;

    // Only the comment author can delete.  If the comment has replies,
    // tombstone it (blank body + deleted_at) so the thread structure
    // stays intact.  Leaf comments with no children are hard-deleted.
    const childCheck = await pool.query(
      'SELECT COUNT(*) AS count FROM card_comments WHERE parent_comment_id = $1',
      [commentId],
    );

    if (parseInt(childCheck.rows[0].count, 10) > 0) {
      const result = await pool.query(`
        UPDATE card_comments
        SET body = '', deleted_at = NOW()
        WHERE id = $1 AND author_pubkey = $2 AND deleted_at IS NULL
        RETURNING id
      `, [commentId, req.user.id]);

      if (result.rows.length === 0) return res.status(404).json({ error: 'Comment not found or not yours' });
      return res.status(204).send();
    }

    const result = await pool.query(
      'DELETE FROM card_comments WHERE id = $1 AND author_pubkey = $2 RETURNING id',
      [commentId, req.user.id],
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// ── Board-level comments (not attached to any card) ─────────────────────

app.get('/api/boards/:listId/comments', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Board not found' });

    const result = await pool.query(`
      SELECT id, list_id, author_pubkey, author_label, body,
             parent_comment_id, deleted_at, external_source, external_id,
             created_at, updated_at
      FROM card_comments
      WHERE list_id = $1 AND card_id IS NULL
      ORDER BY created_at ASC
    `, [listId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching board comments:', error);
    res.status(500).json({ error: 'Failed to fetch board comments' });
  }
});

app.post('/api/boards/:listId/comments', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const access = await listAccess(pool, listId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Board not found' });
    if (!hasAccess(access, 'write')) return res.status(403).json({ error: 'Commenting requires write access' });

    const { body, authorLabel, parentCommentId, externalSource, externalId } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

    const parsedParent = toIntOrNull(parentCommentId);

    // Scope the parent to the same board and to board-level comments only
    // (card_id IS NULL) so threads cannot span boards or mix card/board comments.
    if (parsedParent != null) {
      const parentRow = await pool.query(
        'SELECT id FROM card_comments WHERE id = $1 AND list_id = $2 AND card_id IS NULL',
        [parsedParent, listId],
      );
      if (parentRow.rows.length === 0) {
        return res.status(400).json({ error: 'Parent comment not found on this board' });
      }
    }

    const result = await pool.query(`
      INSERT INTO card_comments (list_id, card_id, author_pubkey, author_label, body,
                                  parent_comment_id, external_source, external_id)
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      listId, req.user.id, emptyToNull(authorLabel),
      body.trim(), parsedParent,
      emptyToNull(externalSource), emptyToNull(externalId),
    ]);

    res.status(201).json({ ...result.rows[0], access });
  } catch (error) {
    // Idempotent dedup, scoped to this board.  409 if the external id
    // collides with a comment on a different board (prevents leaking).
    if (error.code === '23505' && error.constraint === 'idx_card_comments_external') {
      const existing = await pool.query(
        'SELECT * FROM card_comments WHERE external_source = $1 AND external_id = $2 AND list_id = $3',
        [req.body.externalSource, req.body.externalId, listId],
      );
      if (existing.rows.length === 0) {
        return res.status(409).json({ error: 'External identifier already in use on another board' });
      }
      return res.status(200).json(existing.rows[0]);
    }
    console.error('Error creating board comment:', error);
    res.status(500).json({ error: 'Failed to create board comment' });
  }
});

// ── Public board endpoints (unauthenticated read for public boards) ─────
// Comments are NOT exposed publicly: toggling a board public should not
// retroactively publish every comment written while it was private.

app.get('/api/public/boards/:listId', optionalAuth, async (req, res) => {
  try {
    const { listId } = req.params;

    // If the caller is authenticated and has access, use the normal flow
    // but read the real visibility from the row (never hardcode it).
    if (req.user) {
      const access = await listAccess(pool, listId, req.user.id);
      if (access) {
        const boardRow = await pool.query(
          'SELECT visibility, list_type FROM task_lists WHERE id = $1',
          [listId],
        );
        if (boardRow.rows.length === 0 || boardRow.rows[0].list_type !== 'board') {
          return res.status(404).json({ error: 'Board not found' });
        }

        const [colResult, cardResult] = await Promise.all([
          pool.query(`
            SELECT id, name, color, sort_order, collapsed
            FROM board_columns WHERE list_id = $1 ORDER BY sort_order, id
          `, [listId]),
          pool.query(`
            SELECT id, column_id, title, description, priority, due_date,
                   author_pubkey, assignee_pubkey, sort_order,
                   external_id, external_source, created_at, updated_at
            FROM board_cards WHERE list_id = $1 ORDER BY sort_order, id
          `, [listId]),
        ]);

        const cardsByColumn = {};
        for (const card of cardResult.rows) {
          if (!cardsByColumn[card.column_id]) cardsByColumn[card.column_id] = [];
          cardsByColumn[card.column_id].push(card);
        }
        const columns = colResult.rows.map(col => ({ ...col, cards: cardsByColumn[col.id] || [] }));
        return res.json({ columns, access, visibility: boardRow.rows[0].visibility });
      }
    }

    // Unauthenticated (or no access): only serve if the board is public.
    const boardCheck = await pool.query(
      "SELECT id, name FROM task_lists WHERE id = $1 AND list_type = 'board' AND visibility = 'public'",
      [listId],
    );
    if (boardCheck.rows.length === 0) return res.status(404).json({ error: 'Board not found' });

    const [colResult, cardResult] = await Promise.all([
      pool.query(`
        SELECT id, name, color, sort_order, collapsed
        FROM board_columns WHERE list_id = $1 ORDER BY sort_order, id
      `, [listId]),
      // Omit external_source cards from public view: they may contain
      // data the board owner imported under terms that do not extend to
      // anonymous readers.
      pool.query(`
        SELECT id, column_id, title, description, priority, due_date,
               author_pubkey, assignee_pubkey, sort_order,
               created_at, updated_at
        FROM board_cards
        WHERE list_id = $1 AND external_source IS NULL
        ORDER BY sort_order, id
      `, [listId]),
    ]);

    const cardsByColumn = {};
    for (const card of cardResult.rows) {
      if (!cardsByColumn[card.column_id]) cardsByColumn[card.column_id] = [];
      cardsByColumn[card.column_id].push(card);
    }
    const columns = colResult.rows.map(col => ({ ...col, cards: cardsByColumn[col.id] || [] }));

    res.json({ columns, access: 'public', visibility: 'public', board: boardCheck.rows[0] });
  } catch (error) {
    console.error('Error fetching public board:', error);
    res.status(500).json({ error: 'Failed to fetch public board' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  // SQLSTATE 22001: string_data_right_truncation.  Belt-and-braces behind
  // the per-field checks for any bounded column the migration did not widen.
  if (error.code === '22001') {
    return res.status(400).json({ error: 'A value was too long for its column' });
  }
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (pool) {
    await pool.end();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  if (pool) {
    await pool.end();
  }
  process.exit(0);
});

// Allow tests to inject a pool without calling startServer().
function setPool(p) { pool = p; }

export { app, startServer, setPool };

// Start the server when this file is executed directly (not imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer();
} else {
  // Module imported as dependency (e.g. by tests) — do not auto-start.
}