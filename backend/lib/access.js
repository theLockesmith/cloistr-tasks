/**
 * Centralised access-control for task lists.
 *
 * Every endpoint that touches a list, template, or task routes through
 * listAccess() to resolve the caller's permission level.  This replaces
 * the ~20 inline ownership checks that previously lived in server.js.
 */

/** Permission hierarchy, lowest to highest. */
const LEVELS = { read: 1, write: 2, admin: 3, owner: 4 };

/**
 * Resolve the caller's access level on a task list.
 *
 * @param {import('pg').Pool} pool
 * @param {number|string}     listId
 * @param {string}            pubkey  - the caller's Nostr pubkey
 * @returns {Promise<'owner'|'admin'|'write'|'read'|null>}
 *   null means the list does not exist OR the caller has no access.
 */
export async function listAccess(pool, listId, pubkey) {
  const result = await pool.query(`
    SELECT
      CASE WHEN tl.user_id = $2 THEN 'owner'
           ELSE tls.permission
      END AS access
    FROM task_lists tl
    LEFT JOIN task_list_shares tls ON tls.list_id = tl.id AND tls.pubkey = $2
    WHERE tl.id = $1
  `, [listId, pubkey]);

  if (result.rows.length === 0) return null;
  return result.rows[0].access || null;
}

/**
 * Check whether an access level meets or exceeds a required level.
 *
 * @param {string|null} actual    - the level returned by listAccess()
 * @param {'read'|'write'|'admin'|'owner'} required
 * @returns {boolean}
 */
export function hasAccess(actual, required) {
  if (!actual || !required) return false;
  return (LEVELS[actual] || 0) >= (LEVELS[required] || 0);
}

/**
 * Resolve access for a template's parent list.
 *
 * @returns {Promise<{listId: number|null, access: string|null}>}
 */
export async function templateAccess(pool, templateId, pubkey) {
  const result = await pool.query(`
    SELECT tl.id   AS list_id,
           tl.user_id,
           CASE WHEN tl.user_id = $2 THEN 'owner'
                ELSE tls.permission
           END AS access
    FROM task_templates tt
    JOIN task_lists tl ON tl.id = tt.list_id
    LEFT JOIN task_list_shares tls ON tls.list_id = tl.id AND tls.pubkey = $2
    WHERE tt.id = $1
  `, [templateId, pubkey]);

  if (result.rows.length === 0) return { listId: null, access: null };
  return {
    listId: result.rows[0].list_id,
    access: result.rows[0].access || null,
  };
}

/**
 * Resolve access for a board card's parent list.
 *
 * @returns {Promise<{listId: number|null, columnId: number|null, access: string|null}>}
 */
export async function cardAccess(pool, cardId, pubkey) {
  const result = await pool.query(`
    SELECT tl.id   AS list_id,
           bc.column_id,
           CASE WHEN tl.user_id = $2 THEN 'owner'
                ELSE tls.permission
           END AS access
    FROM board_cards bc
    JOIN task_lists tl ON tl.id = bc.list_id
    LEFT JOIN task_list_shares tls ON tls.list_id = tl.id AND tls.pubkey = $2
    WHERE bc.id = $1
  `, [cardId, pubkey]);

  if (result.rows.length === 0) return { listId: null, columnId: null, access: null };
  return {
    listId: result.rows[0].list_id,
    columnId: result.rows[0].column_id,
    access: result.rows[0].access || null,
  };
}

/**
 * Resolve access for a task instance's parent list.
 *
 * @returns {Promise<{listId: number|null, access: string|null}>}
 */
export async function taskAccess(pool, taskId, pubkey) {
  const result = await pool.query(`
    SELECT tl.id   AS list_id,
           CASE WHEN tl.user_id = $2 THEN 'owner'
                ELSE tls.permission
           END AS access
    FROM tasks t
    JOIN task_lists tl ON tl.id = t.list_id
    LEFT JOIN task_list_shares tls ON tls.list_id = tl.id AND tls.pubkey = $2
    WHERE t.id = $1
  `, [taskId, pubkey]);

  if (result.rows.length === 0) return { listId: null, access: null };
  return {
    listId: result.rows[0].list_id,
    access: result.rows[0].access || null,
  };
}
