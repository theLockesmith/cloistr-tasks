/**
 * Unit tests for the pure helper functions in frontend/src/lib/taskHelpers.js.
 *
 * These helpers are exported from taskHelpers.js (which TaskItem.js also
 * imports), so every test here exercises the REAL production implementation,
 * not a copy.  If the implementation diverges from these tests, the tests
 * will fail.
 *
 * What cannot be tested here without a DOM / render environment:
 *   - The TaskItem React component itself (requires jsdom + @testing-library)
 *   - Any hook that calls useState / useEffect
 *   - Event handlers (onClick, onChange) inside the component
 *
 * Add DOM tests in a separate suite after configuring vitest with
 * { environment: 'jsdom' } and installing @testing-library/react.
 */

import { formatDueDate, normaliseLabels, parseSubtaskCount } from '../lib/taskHelpers';

// ── formatDueDate ──────────────────────────────────────────────────────────

const todayStr = new Date().toISOString().split('T')[0];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

describe('formatDueDate', () => {
  test('returns null for null',      () => expect(formatDueDate(null)).toBeNull());
  test('returns null for undefined', () => expect(formatDueDate(undefined)).toBeNull());
  test('returns null for empty string', () => expect(formatDueDate('')).toBeNull());

  test('today returns "Due today" with soon=true and overdue=false', () => {
    const r = formatDueDate(todayStr);
    expect(r.label).toBe('Due today');
    expect(r.overdue).toBe(false);
    expect(r.soon).toBe(true);
  });

  test('strips ISO timestamp suffix before comparing (pg DATE serialisation)', () => {
    const r = formatDueDate(todayStr + 'T00:00:00.000Z');
    expect(r.label).toBe('Due today');
  });

  test('yesterday returns "Overdue" with overdue=true', () => {
    const r = formatDueDate(dateOffset(-1));
    expect(r.overdue).toBe(true);
    expect(r.label).toBe('Overdue');
    expect(r.soon).toBe(false);
  });

  test('7 days ago returns "Overdue"', () => {
    expect(formatDueDate(dateOffset(-7)).overdue).toBe(true);
  });

  test('2 days ahead is soon but not overdue', () => {
    const r = formatDueDate(dateOffset(2));
    expect(r.overdue).toBe(false);
    expect(r.soon).toBe(true);
  });

  test('exactly 3 days ahead is the boundary for soon', () => {
    const r = formatDueDate(dateOffset(3));
    expect(r.soon).toBe(true);
  });

  test('4 days ahead is not soon', () => {
    const r = formatDueDate(dateOffset(4));
    expect(r.soon).toBe(false);
  });

  test('30 days ahead returns a formatted label, not overdue, not soon', () => {
    const r = formatDueDate(dateOffset(30));
    expect(r.overdue).toBe(false);
    expect(r.soon).toBe(false);
    // label is a locale-formatted date string like "Sep 22"
    expect(typeof r.label).toBe('string');
    expect(r.label.length).toBeGreaterThan(0);
  });
});

// ── normaliseLabels ───────────────────────────────────────────────────────

describe('normaliseLabels', () => {
  test('passes an array through unchanged', () => {
    const labels = [{ id: 1, name: 'Work' }];
    expect(normaliseLabels(labels)).toBe(labels);
  });
  test('returns empty array for null',       () => expect(normaliseLabels(null)).toEqual([]));
  test('returns empty array for undefined',  () => expect(normaliseLabels(undefined)).toEqual([]));
  test('returns empty array for a string',   () => expect(normaliseLabels('[]')).toEqual([]));
  test('returns empty array for a number',   () => expect(normaliseLabels(42)).toEqual([]));
  test('empty array passthrough',            () => expect(normaliseLabels([])).toEqual([]));
});

// ── parseSubtaskCount ─────────────────────────────────────────────────────

describe('parseSubtaskCount', () => {
  test('0 for undefined',     () => expect(parseSubtaskCount(undefined)).toBe(0));
  test('0 for null',          () => expect(parseSubtaskCount(null)).toBe(0));
  test('0 for empty string',  () => expect(parseSubtaskCount('')).toBe(0));
  test('3 for string "3"',    () => expect(parseSubtaskCount('3')).toBe(3));
  test('2 for number 2',      () => expect(parseSubtaskCount(2)).toBe(2));
  test('0 for non-numeric',   () => expect(parseSubtaskCount('abc')).toBe(0));
});
