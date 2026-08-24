/**
 * Unit tests for the pure helper functions in backend/utils.js.
 *
 * These functions are exported from utils.js (which server.js also imports),
 * so every test here exercises the REAL production implementation — not a copy.
 * If the implementation changes, these tests will catch the divergence.
 *
 * What cannot be tested here without a running server and database:
 *   - HTTP route handlers (require a live Express + Postgres connection)
 *   - Authentication middleware (requires a signed JWT and a DB user row)
 *   - Any query that reads from or writes to the task_* tables
 *
 * Add those in a separate integration test suite that provisions a test
 * database.
 */

import {
  emptyToNull,
  toIntOrNull,
  validateLabelName,
  wouldCreateNestedSubtask,
  parseReminderOffset,
} from '../utils.js';

// ── emptyToNull ────────────────────────────────────────────────────────────

describe('emptyToNull', () => {
  test('returns null for undefined', () => expect(emptyToNull(undefined)).toBeNull());
  test('returns null for null',      () => expect(emptyToNull(null)).toBeNull());
  test('returns null for ""',        () => expect(emptyToNull('')).toBeNull());
  test('returns value for "0"',      () => expect(emptyToNull('0')).toBe('0'));
  test('returns value for 0',        () => expect(emptyToNull(0)).toBe(0));
  test('returns value for false',    () => expect(emptyToNull(false)).toBe(false));
  test('returns value for "abc"',    () => expect(emptyToNull('abc')).toBe('abc'));
});

// ── toIntOrNull ────────────────────────────────────────────────────────────

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

// ── validateLabelName ─────────────────────────────────────────────────────

describe('validateLabelName', () => {
  test('rejects undefined',    () => expect(validateLabelName(undefined).ok).toBe(false));
  test('rejects empty string', () => expect(validateLabelName('').ok).toBe(false));
  test('rejects whitespace',   () => expect(validateLabelName('   ').ok).toBe(false));
  test('error text is set on failure', () => {
    expect(validateLabelName('').error).toBe('Label name is required');
  });
  test('accepts a normal name and trims it', () => {
    const r = validateLabelName('  Work  ');
    expect(r.ok).toBe(true);
    expect(r.name).toBe('Work');
  });
  test('accepts a single character', () => {
    const r = validateLabelName('x');
    expect(r.ok).toBe(true);
    expect(r.name).toBe('x');
  });
});

// ── wouldCreateNestedSubtask ──────────────────────────────────────────────

describe('wouldCreateNestedSubtask', () => {
  test('top-level parent (null parent_template_id) is safe',
    () => expect(wouldCreateNestedSubtask({ parent_template_id: null })).toBe(false));
  test('sub-task parent (non-null parent_template_id) is rejected',
    () => expect(wouldCreateNestedSubtask({ parent_template_id: 5 })).toBe(true));
  test('null parentRow counts as no nesting',
    () => expect(wouldCreateNestedSubtask(null)).toBe(false));
  test('parent_template_id of 0 is treated as non-null (falsy numeric)',
    // 0 is technically a valid id, but practically never assigned; the
    // function guards with !!(row && row.parent_template_id !== null).
    () => expect(wouldCreateNestedSubtask({ parent_template_id: 0 })).toBe(true));
});

// ── parseReminderOffset ───────────────────────────────────────────────────

describe('parseReminderOffset', () => {
  test('null for empty string',  () => expect(parseReminderOffset('')).toBeNull());
  test('null for zero',          () => expect(parseReminderOffset(0)).toBeNull());
  test('null for negative',      () => expect(parseReminderOffset(-5)).toBeNull());
  test('15 for "15"',            () => expect(parseReminderOffset('15')).toBe(15));
  test('1440 for "1440"',        () => expect(parseReminderOffset('1440')).toBe(1440));
  test('null for non-numeric',   () => expect(parseReminderOffset('abc')).toBeNull());
  test('truncates fractional and accepts if positive',
    () => expect(parseReminderOffset('5.9')).toBe(5));
});
