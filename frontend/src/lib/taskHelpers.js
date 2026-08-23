/**
 * Pure helper functions for task display logic.
 *
 * All functions are side-effect-free and do not depend on React or the DOM,
 * so they can be imported and tested without a browser environment.
 */

/**
 * Format a raw due-date string (YYYY-MM-DD or an ISO timestamp) into a
 * human-readable label object, or return null when no date is given.
 *
 * The comparison is always relative to the viewer's local date (via
 * Date().toISOString() which normalises to UTC midnight, giving consistent
 * "today" across timezones for date-only values stored in Postgres DATE
 * columns).
 *
 * @param {string|null|undefined} rawDate
 * @returns {{ label: string, overdue: boolean, soon: boolean }|null}
 */
export function formatDueDate(rawDate) {
  if (!rawDate) return null;
  // Postgres DATE columns are serialised as ISO timestamps; strip the time part.
  const dateStr = rawDate.split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  if (dateStr === today) return { label: 'Due today', overdue: false, soon: true };
  if (dateStr < today)  return { label: 'Overdue',   overdue: true,  soon: false };
  const daysAhead = (new Date(dateStr) - new Date(today)) / 86400000;
  const label = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return { label, overdue: false, soon: daysAhead <= 3 };
}

/**
 * Coerce a raw `task.labels` value to an array.
 * The API always returns an array, but a missing or null field must not crash
 * the render.
 *
 * @param {unknown} raw
 * @returns {Array}
 */
export function normaliseLabels(raw) {
  return Array.isArray(raw) ? raw : [];
}

/**
 * Parse the raw subtask_count column value (returned as a string by pg) into
 * a number, defaulting to 0.
 *
 * @param {unknown} raw
 * @returns {number}
 */
export function parseSubtaskCount(raw) {
  return Number(raw) || 0;
}
