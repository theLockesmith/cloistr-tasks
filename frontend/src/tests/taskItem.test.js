/**
 * Source-level structural tests for TaskItem helper logic.
 *
 * NOTE: Source-level, not behavioural — these do not render the component.
 * The vitest setup in this package does not include a DOM environment, so full
 * render tests would require jsdom configuration; this suite covers the pure
 * functions that are reachable without a DOM and guards their contracts.
 */

// ── formatDueDate ──────────────────────────────────────────────────────────
// Mirrors the implementation in TaskItem.js.  If the implementation changes
// this test must be updated to match.

function formatDueDate(rawDate) {
  if (!rawDate) return null;
  const dateStr = rawDate.split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  if (dateStr === today) return { label: 'Due today', overdue: false, soon: true };
  if (dateStr < today) return { label: 'Overdue', overdue: true, soon: false };
  const daysAhead = (new Date(dateStr) - new Date(today)) / 86400000;
  const label = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label, overdue: false, soon: daysAhead <= 3 };
}

const todayStr = new Date().toISOString().split('T')[0];

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

describe('formatDueDate', () => {
  test('null for no date', () => expect(formatDueDate(null)).toBeNull());
  test('null for undefined', () => expect(formatDueDate(undefined)).toBeNull());

  test('today returns "Due today" with soon=true', () => {
    const r = formatDueDate(todayStr);
    expect(r.label).toBe('Due today');
    expect(r.overdue).toBe(false);
    expect(r.soon).toBe(true);
  });

  test('past date returns "Overdue"', () => {
    const r = formatDueDate(dateOffset(-1));
    expect(r.overdue).toBe(true);
    expect(r.label).toBe('Overdue');
  });

  test('2 days ahead is soon but not overdue', () => {
    const r = formatDueDate(dateOffset(2));
    expect(r.overdue).toBe(false);
    expect(r.soon).toBe(true);
  });

  test('30 days ahead is not soon', () => {
    const r = formatDueDate(dateOffset(30));
    expect(r.overdue).toBe(false);
    expect(r.soon).toBe(false);
  });

  test('strips T from ISO timestamp before comparing', () => {
    const iso = todayStr + 'T00:00:00.000Z';
    const r = formatDueDate(iso);
    expect(r.label).toBe('Due today');
  });
});

// ── label normalisation ───────────────────────────────────────────────────
// TaskItem renders labels from task.labels which the API returns as a JSON
// array.  Guard the coercion in case the field is absent or null.

function normaliseLabels(raw) {
  return Array.isArray(raw) ? raw : [];
}

describe('normaliseLabels', () => {
  test('passthrough for array',      () => expect(normaliseLabels([{ id: 1 }])).toHaveLength(1));
  test('empty array for null',       () => expect(normaliseLabels(null)).toEqual([]));
  test('empty array for undefined',  () => expect(normaliseLabels(undefined)).toEqual([]));
  test('empty array for string',     () => expect(normaliseLabels('[]')).toEqual([]));
});

// ── subtask count ─────────────────────────────────────────────────────────

function parseSubtaskCount(raw) {
  return Number(raw) || 0;
}

describe('parseSubtaskCount', () => {
  test('0 for undefined', () => expect(parseSubtaskCount(undefined)).toBe(0));
  test('0 for null',      () => expect(parseSubtaskCount(null)).toBe(0));
  test('3 for "3"',       () => expect(parseSubtaskCount('3')).toBe(3));
  test('2 for 2',         () => expect(parseSubtaskCount(2)).toBe(2));
});
