// backend/server.js - Task Manager Backend with Nostr Authentication
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import crypto from 'crypto';
import dotenv from 'dotenv';

import { initializeDatabase, createPool, createAppPool } from './database/init.js';
import { authenticateToken, optionalAuth, requireOwnership, issueJWT } from './middleware/auth.js';

// Import nostr-tools for signature verification
import { verifyEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Global database pool
let pool;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

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

// Get all task lists (user-specific)
app.get('/api/lists', authenticateToken, async (req, res) => {
  try {
    await syncUser(req.user);
    
    const result = await pool.query(`
      SELECT l.*, 
             COUNT(t.id) as total_tasks,
             COUNT(CASE WHEN t.completed_at IS NOT NULL THEN 1 END) as completed_tasks
      FROM task_lists l
      LEFT JOIN tasks t ON l.id = t.list_id AND DATE(t.reset_date) = CURRENT_DATE
      WHERE l.user_id = $1 AND l.active = true
      GROUP BY l.id
      ORDER BY l.sort_order, l.name
    `, [req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching lists:', error);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

// Get tasks for a specific list (with ownership check)
app.get('/api/lists/:listId/tasks', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    // Check ownership inline
    const ownershipCheck = await pool.query('SELECT user_id FROM task_lists WHERE id = $1', [listId]);
    if (ownershipCheck.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (ownershipCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const result = await pool.query(`
      SELECT t.*, tt.name as template_name, tt.description as template_description,
             tt.time_slot, tt.estimated_minutes
      FROM tasks t
      JOIN task_templates tt ON t.template_id = tt.id
      JOIN task_lists tl ON t.list_id = tl.id
      WHERE t.list_id = $1 AND DATE(t.reset_date) = $2 AND tl.user_id = $3
      ORDER BY tt.sort_order, tt.name
    `, [listId, today, req.user.id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Toggle task completion (with ownership check)
app.post('/api/tasks/:taskId/toggle', authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    
    const result = await pool.query(`
      UPDATE tasks 
      SET completed_at = CASE 
        WHEN completed_at IS NULL THEN NOW() 
        ELSE NULL 
      END,
      updated_at = NOW()
      FROM task_lists tl
      WHERE tasks.list_id = tl.id 
      AND tasks.id = $1 
      AND tl.user_id = $2
      RETURNING tasks.*
    `, [taskId, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found or access denied' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error toggling task:', error);
    res.status(500).json({ error: 'Failed to toggle task' });
  }
});

// Create new task list (user-specific)
app.post('/api/lists', authenticateToken, async (req, res) => {
  try {
    await syncUser(req.user);
    
    const { name, description, icon, color } = req.body;
    
    // First, get the next sort order for this user
    const sortResult = await pool.query(`
      SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort_order
      FROM task_lists 
      WHERE user_id = $1
    `, [req.user.id]);
    
    const nextSortOrder = sortResult.rows[0].next_sort_order;
    
    // Then insert the new list
    const result = await pool.query(`
      INSERT INTO task_lists (name, description, icon, color, user_id, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      name, 
      description, 
      icon || '📋', 
      color || '#3b82f6', 
      req.user.id, 
      nextSortOrder
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating list:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

// Add task template to list (with ownership check)
app.post('/api/lists/:listId/templates', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const { name, description, timeSlot, estimatedMinutes } = req.body;
    
    // Check ownership inline
    const ownershipCheck = await pool.query('SELECT user_id FROM task_lists WHERE id = $1', [listId]);
    if (ownershipCheck.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }
    if (ownershipCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Create the template
    const templateResult = await pool.query(`
      INSERT INTO task_templates (list_id, name, description, time_slot, estimated_minutes, sort_order)
      VALUES ($1, $2, $3, $4, $5, (
        SELECT COALESCE(MAX(sort_order), 0) + 1 
        FROM task_templates 
        WHERE list_id = $1
      ))
      RETURNING *
    `, [listId, name, description, timeSlot, estimatedMinutes]);
    
    const newTemplate = templateResult.rows[0];
    
    // Automatically create today's task instance from this template
    const taskResult = await pool.query(`
      INSERT INTO tasks (template_id, list_id, reset_date, created_at)
      VALUES ($1, $2, CURRENT_DATE, NOW())
      ON CONFLICT (template_id, reset_date) DO NOTHING
      RETURNING *
    `, [newTemplate.id, listId]);
    
    console.log(`Created template ${newTemplate.id} and task instance for today`);
    
    res.status(201).json(newTemplate);
  } catch (error) {
    console.error('Error creating task template:', error);
    res.status(500).json({ error: 'Failed to create task template' });
  }
});

// Update task template (with ownership check)
app.put('/api/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const { templateId } = req.params;
    const { name, description, timeSlot, estimatedMinutes } = req.body;
    
    const result = await pool.query(`
      UPDATE task_templates 
      SET name = $1, description = $2, time_slot = $3, estimated_minutes = $4, updated_at = NOW()
      FROM task_lists tl
      WHERE task_templates.list_id = tl.id
      AND task_templates.id = $5
      AND tl.user_id = $6
      RETURNING task_templates.*
    `, [name, description, timeSlot, estimatedMinutes, templateId, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found or access denied' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete task template (with ownership check)
app.delete('/api/templates/:templateId', authenticateToken, async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const result = await pool.query(`
      DELETE FROM task_templates 
      USING task_lists tl
      WHERE task_templates.list_id = tl.id
      AND task_templates.id = $1
      AND tl.user_id = $2
      RETURNING task_templates.id
    `, [templateId, req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found or access denied' });
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

// Get user analytics
app.get('/api/user/analytics', authenticateToken, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
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
      AND t.reset_date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(t.reset_date), tl.id, tl.name, tl.icon
      ORDER BY date DESC, tl.sort_order
    `, [req.user.id]);
    
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

// Error handling middleware
app.use((error, req, res, next) => {
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

// Start the server
startServer();