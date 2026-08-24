/**
 * Pure helper utilities shared across route handlers.
 *
 * All functions here are side-effect-free and accept only plain JS values,
 * which makes them testable in isolation without a running server or database.
 */

/**
 * Normalise empty-ish values to null so Postgres does not receive an empty
 * string where it expects a typed column (INTEGER, DATE, etc.).
 */
export const emptyToNull = (v) =>
  v === undefined || v === null || v === '' ? null : v;

/**
 * Coerce a value to an integer or null.  Fractional values are truncated.
 * Non-numeric strings return null.
 */
export const toIntOrNull = (v) => {
  const base = emptyToNull(v);
  if (base === null) return null;
  const n = Number(base);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * Validate a label name from request body.
 * Returns { ok: true, name: string } or { ok: false, error: string }.
 */
export function validateLabelName(name) {
  if (!name || !String(name).trim()) {
    return { ok: false, error: 'Label name is required' };
  }
  return { ok: true, name: String(name).trim() };
}

/**
 * Return true if the given DB row represents a sub-task (i.e. already has a
 * parent), which would mean creating another child under it would be a
 * disallowed nested sub-task.
 *
 * @param {object|null} parentRow - row from task_templates, or null if absent
 */
export function wouldCreateNestedSubtask(parentRow) {
  return !!(parentRow && parentRow.parent_template_id !== null);
}

/**
 * Parse a reminder offset value into a positive integer of minutes, or null.
 * Zero and negative values are rejected (a reminder 0 minutes before an event
 * is meaningless).
 */
export function parseReminderOffset(v) {
  const n = toIntOrNull(v);
  if (n === null) return null;
  return n > 0 ? n : null;
}
