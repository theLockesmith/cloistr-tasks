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
 * Determine whether a recurring task's time-of-day deadline has passed for
 * today and the task instance is not yet completed.
 *
 * recurring_deadline is a "HH:MM" (24h) string that applies every day the
 * template is active — distinct from due_date, which is a one-time calendar
 * date. A task is overdue-by-deadline only for the current day; there is no
 * "N days overdue" concept the way there is for due_date.
 *
 * @param {string|null|undefined} recurringDeadline - "HH:MM" or falsy
 * @param {string|null|undefined} completedAt - ISO timestamp or falsy
 * @param {Date} [now] - injectable for testing
 * @returns {boolean}
 */
export function isDeadlinePassed(recurringDeadline, completedAt, now = new Date()) {
  if (!recurringDeadline || completedAt) return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(recurringDeadline);
  if (!match) return false;
  const [, hours, minutes] = match;
  const deadline = new Date(now);
  deadline.setHours(Number(hours), Number(minutes), 0, 0);
  return now.getTime() > deadline.getTime();
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
