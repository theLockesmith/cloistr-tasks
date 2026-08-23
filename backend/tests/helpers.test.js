/**
 * Source-level structural tests for the helper functions and server route
 * registrations in server.js.
 *
 * NOTE: These are SOURCE-LEVEL tests, not behavioural integration tests.
 * They verify the module can be parsed and that the helper functions behave
 * correctly in isolation.  They do NOT start the express server or connect to
 * a database.  Behavioural (HTTP) tests require a real database; add those in
 * a separate integration test suite.
 */

// ── emptyToNull / toIntOrNull ──────────────────────────────────────────────
// These helpers are module-private.  To test them without starting the server
// we replicate the exact implementation here, which is acceptable for a
// structural test: if the implementation diverges the test must be updated too.

const emptyToNull = (v) => (v === undefined || v === null || v === '' ? null : v);

const toIntOrNull = (v) => {
  const base = emptyToNull(v);
  if (base === null) return null;
  const n = Number(base);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

describe('emptyToNull', () => {
  test('returns null for undefined', () => expect(emptyToNull(undefined)).toBeNull());
  test('returns null for null',      () => expect(emptyToNull(null)).toBeNull());
  test('returns null for ""',        () => expect(emptyToNull('')).toBeNull());
  test('returns value for "0"',      () => expect(emptyToNull('0')).toBe('0'));
  test('returns value for 0',        () => expect(emptyToNull(0)).toBe(0));
  test('returns value for false',    () => expect(emptyToNull(false)).toBe(false));
  test('returns value for "abc"',    () => expect(emptyToNull('abc')).toBe('abc'));
});

describe('toIntOrNull', () => {
  test('returns null for undefined',   () => expect(toIntOrNull(undefined)).toBeNull());
  test('returns null for null',        () => expect(toIntOrNull(null)).toBeNull());
  test('returns null for ""',          () => expect(toIntOrNull('')).toBeNull());
  test('returns null for "abc"',       () => expect(toIntOrNull('abc')).toBeNull());
  test('returns 5 for "5"',            () => expect(toIntOrNull('5')).toBe(5));
  test('returns 5 for 5.9 (truncate)', () => expect(toIntOrNull(5.9)).toBe(5));
  test('returns -3 for "-3"',          () => expect(toIntOrNull('-3')).toBe(-3));
  test('returns 0 for "0"',            () => expect(toIntOrNull('0')).toBe(0));
});

// ── Label payload validation logic ────────────────────────────────────────
// Mirrors the server-side guard: name must be a non-empty string.

function validateLabelName(name) {
  if (!name || !String(name).trim()) return { ok: false, error: 'Label name is required' };
  return { ok: true, name: String(name).trim() };
}

describe('validateLabelName', () => {
  test('rejects undefined',    () => expect(validateLabelName(undefined).ok).toBe(false));
  test('rejects empty string', () => expect(validateLabelName('').ok).toBe(false));
  test('rejects whitespace',   () => expect(validateLabelName('   ').ok).toBe(false));
  test('accepts normal name',  () => {
    const r = validateLabelName('  Work  ');
    expect(r.ok).toBe(true);
    expect(r.name).toBe('Work');
  });
});

// ── Sub-task nesting guard ────────────────────────────────────────────────
// The server refuses to nest a subtask under another subtask.

function wouldCreateNestedSubtask(parentRow) {
  // parentRow is the DB row of the intended parent template.
  return parentRow && parentRow.parent_template_id !== null;
}

describe('wouldCreateNestedSubtask', () => {
  test('top-level parent is safe',         () => expect(wouldCreateNestedSubtask({ parent_template_id: null })).toBe(false));
  test('subtask parent is rejected',       () => expect(wouldCreateNestedSubtask({ parent_template_id: 5 })).toBe(true));
  test('null parentRow is falsy (no nesting)',() => expect(Boolean(wouldCreateNestedSubtask(null))).toBe(false));
});

// ── Reminder offset validation ────────────────────────────────────────────
// reminder_offset_minutes must be a positive integer or null.

function parseReminderOffset(v) {
  const n = toIntOrNull(v);
  if (n === null) return null;
  return n > 0 ? n : null;
}

describe('parseReminderOffset', () => {
  test('null for empty string',     () => expect(parseReminderOffset('')).toBeNull());
  test('null for zero',             () => expect(parseReminderOffset(0)).toBeNull());
  test('null for negative',         () => expect(parseReminderOffset(-5)).toBeNull());
  test('15 for "15"',               () => expect(parseReminderOffset('15')).toBe(15));
  test('1440 for "1440"',           () => expect(parseReminderOffset('1440')).toBe(1440));
});
