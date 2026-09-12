/**
 * AuthenticatedApp structural tests.
 *
 * AuthenticatedApp is the authenticated shell — it owns list loading, task
 * preview filtering, drag-reorder, theme application, keyboard shortcuts,
 * and modal routing.  These tests verify structural contracts at the source
 * level, matching the project's established pattern.
 *
 * Companion tests for narrower concerns:
 *   - listReorderKey.test.js  — sortOrder key casing in reorderLists
 *   - dragDropClick.test.js   — setPointerCapture placement in DragDropList
 *   - accessHelpers.test.js   — isSharedList / canWriteList logic
 */

import fs from 'fs';
import path from 'path';

const componentPath = path.resolve(
  __dirname, '../components/AuthenticatedApp.js',
);
const src = fs.readFileSync(componentPath, 'utf8');

// ── Helpers ─────────────────────────────────────────────────────────────

/** Extract a useEffect body by a unique string it contains. */
function extractEffect(source, marker) {
  const idx = source.indexOf(marker);
  if (idx === -1) return '';
  const start = Math.max(0, source.lastIndexOf('useEffect(', idx));
  const depsClose = source.indexOf(']);', idx);
  if (depsClose === -1) return source.slice(start, idx + 200);
  return source.slice(start, depsClose + 3);
}

/** Extract a named function/const body. */
function extractFunction(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) return '';
  return source.slice(start, start + 800);
}

// ── Identity-scoped refresh ─────────────────────────────────────────────

describe('identity-scoped refresh on key switch', () => {
  // Extract the pubkey-dependent useEffect and its deps array as one block.
  // We look for the deps array containing user?.pubkey then walk back to
  // the enclosing useEffect(.
  const depsIdx = src.indexOf('[user?.pubkey]');
  const effectStart = src.lastIndexOf('useEffect(', depsIdx);
  const effectEnd = src.indexOf(');', depsIdx) + 2;
  const keyEffect = (effectStart >= 0 && depsIdx >= 0)
    ? src.slice(effectStart, effectEnd)
    : '';

  test('useEffect with user?.pubkey dependency exists', () => {
    expect(keyEffect.length).toBeGreaterThan(0);
    expect(keyEffect).toContain('user?.pubkey');
  });

  test('resets lists to empty on key switch', () => {
    expect(keyEffect).toContain('setLists([])');
  });

  test('resets selectedList to null on key switch', () => {
    expect(keyEffect).toContain('setSelectedList(null)');
  });

  test('resets taskPreviews to empty on key switch', () => {
    expect(keyEffect).toContain('setTaskPreviews({})');
  });

  test('sets loading true before re-fetch', () => {
    expect(keyEffect).toContain('setLoading(true)');
  });

  test('calls loadLists and loadUserSettings', () => {
    expect(keyEffect).toContain('loadLists()');
    expect(keyEffect).toContain('loadUserSettings()');
  });
});

// ── Theme application ───────────────────────────────────────────────────

describe('theme application', () => {
  const themeEffect = extractEffect(src, 'data-theme');

  test('sets data-theme attribute on documentElement', () => {
    expect(themeEffect).toMatch(
      /document\.documentElement\.setAttribute\(\s*['"]data-theme['"]/,
    );
  });

  test('respects prefers-color-scheme for system theme', () => {
    expect(themeEffect).toMatch(/prefers-color-scheme:\s*dark/);
  });

  test('system theme listens for media query changes', () => {
    expect(src).toMatch(/mediaQuery\.addEventListener\(\s*['"]change['"]/);
    expect(src).toMatch(/mediaQuery\.removeEventListener\(\s*['"]change['"]/);
  });
});

// ── Escape key priority ─────────────────────────────────────────────────

describe('Escape key handler', () => {
  const keyEffect = extractEffect(src, "e.key === 'Escape'");

  test('closes settings first (highest priority)', () => {
    const escapeBlock = keyEffect.slice(keyEffect.indexOf("'Escape'"));
    const settingsIdx = escapeBlock.indexOf('showSettings');
    const addListIdx = escapeBlock.indexOf('showAddList');
    const addTaskIdx = escapeBlock.indexOf('showAddTask');
    const selectedIdx = escapeBlock.indexOf('selectedList');

    expect(settingsIdx).toBeGreaterThan(-1);
    expect(settingsIdx).toBeLessThan(addListIdx);
    expect(addListIdx).toBeLessThan(addTaskIdx);
    expect(addTaskIdx).toBeLessThan(selectedIdx);
  });

  test('depends on all four modal states', () => {
    expect(keyEffect).toMatch(
      /\[.*showSettings.*showAddList.*showAddTask.*selectedList.*\]/,
    );
  });

  test('cleans up the event listener on unmount', () => {
    expect(keyEffect).toMatch(/removeEventListener\(\s*['"]keydown['"]/);
  });
});

// ── Completion percentage (division-by-zero guard) ──────────────────────

describe('getCompletionPercentage', () => {
  const fn = extractFunction(src, 'getCompletionPercentage');

  test('returns 0 when total_tasks is 0 (no division by zero)', () => {
    expect(fn).toMatch(/total\s*===?\s*0.*return\s+0/s);
  });

  test('uses Math.round for clean percentages', () => {
    expect(fn).toMatch(/Math\.round/);
  });
});

// ── Progress color interpolation ────────────────────────────────────────

describe('getProgressColor', () => {
  const fn = extractFunction(src, 'getProgressColor');

  test('returns error color for 0%', () => {
    expect(fn).toMatch(/percentage\s*===?\s*0.*cloistr-error/s);
  });

  test('returns success color for 100%', () => {
    expect(fn).toMatch(/percentage\s*===?\s*100.*cloistr-success/s);
  });

  test('uses color-mix for intermediate values', () => {
    expect(fn).toMatch(/color-mix\(/);
  });
});

// ── Task preview filtering ──────────────────────────────────────────────

describe('getTaskPreviewForList', () => {
  const fn = extractFunction(src, 'getTaskPreviewForList');

  test('separates incomplete and completed tasks', () => {
    expect(fn).toMatch(/filter\(\s*task\s*=>\s*!task\.completed_at\)/);
    expect(fn).toMatch(/filter\(\s*task\s*=>\s*task\.completed_at\)/);
  });

  test('respects previewTaskCount setting', () => {
    expect(fn).toMatch(/userSettings\.previewTaskCount/);
  });

  test('respects showCompletedInPreview setting', () => {
    expect(fn).toMatch(/userSettings\.showCompletedInPreview/);
  });
});

// ── Access helper integration ───────────────────────────────────────────

describe('access helpers usage', () => {
  test('imports all three access helpers', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*isSharedList[^}]*shareLabel[^}]*canWriteList[^}]*\}/,
    );
  });

  test('canWriteList guards the task toggle click handler', () => {
    const toggleSection = src.slice(
      src.indexOf('task-preview-checkbox'),
      src.indexOf('task-preview-checkbox') + 500,
    );
    expect(toggleSection).toMatch(/canWriteList\(list\)/);
  });

  test('isSharedList gates the share label badge', () => {
    expect(src).toMatch(/isSharedList\(list\)\s*&&/);
  });
});

// ── Header auth prop ────────────────────────────────────────────────────

describe('Header integration', () => {
  test('passes explicit auth prop with pubkey to Header', () => {
    expect(src).toMatch(
      /auth=\{\{\s*authenticated:\s*true,\s*pubkey:\s*user\?\.\s*pubkey/,
    );
  });

  test('passes onLogout callback to Header', () => {
    expect(src).toMatch(/onLogout:\s*logout/);
  });

  test('sets activeServiceId to tasks', () => {
    expect(src).toMatch(/activeServiceId=["']tasks["']/);
  });
});

// ── Modal wiring ────────────────────────────────────────────────────────

describe('modal wiring', () => {
  test('AddListModal gated by showAddList', () => {
    expect(src).toMatch(/\{showAddList\s*&&\s*[\s\S]*?<AddListModal/);
  });

  test('AddTaskModal gated by showAddTask AND selectedList', () => {
    expect(src).toMatch(
      /\{showAddTask\s*&&\s*selectedList\s*&&\s*[\s\S]*?<AddTaskModal/,
    );
  });

  test('TaskListModal gated by selectedList', () => {
    expect(src).toMatch(/\{selectedList\s*&&\s*[\s\S]*?<TaskListModal/);
  });

  test('UserSettings gated by showSettings', () => {
    expect(src).toMatch(/\{showSettings\s*&&\s*[\s\S]*?<UserSettings/);
  });

  test('LabelManager gated by showLabelManager', () => {
    expect(src).toMatch(/\{showLabelManager\s*&&\s*[\s\S]*?<LabelManager/);
  });
});

// ── Loading state ───────────────────────────────────────────────────────

describe('loading state', () => {
  test('shows spinner while loading', () => {
    expect(src).toMatch(/loading[\s\S]*?className=["']spinner["']/);
  });

  test('shows user-facing loading message', () => {
    expect(src).toMatch(/Loading your routines/);
  });
});

// ── Board routing ───────────────────────────────────────────────────────

describe('board-type list routing', () => {
  test('imports BoardView component', () => {
    expect(src).toMatch(/import\s+BoardView\s+from\s+['"]\.\/BoardView['"]/);
  });

  test('routes board-type lists to BoardView instead of TaskListModal', () => {
    // When selectedList.list_type === 'board', BoardView should render.
    expect(src).toMatch(/selectedList\.list_type\s*===\s*['"]board['"]\s*\?\s*[\s\S]*?<BoardView/);
  });

  test('BoardView receives list, onClose, apiCall, and user props', () => {
    const boardSection = src.slice(src.indexOf('<BoardView'), src.indexOf('<BoardView') + 300);
    expect(boardSection).toMatch(/list=\{selectedList\}/);
    expect(boardSection).toMatch(/onClose=/);
    expect(boardSection).toMatch(/apiCall=\{apiCall\}/);
    expect(boardSection).toMatch(/user=\{user\}/);
  });

  test('non-board lists still route to TaskListModal', () => {
    // TaskListModal must still exist for recurring/completion lists.
    expect(src).toMatch(/<TaskListModal/);
  });
});

// ── Board card indicator ────────────────────────────────────────────────

describe('board card indicator on dashboard', () => {
  test('board-type lists show Kanban Board label instead of progress bar', () => {
    expect(src).toMatch(/list\.list_type\s*===\s*['"]board['"]/);
    expect(src).toMatch(/Kanban Board/);
  });

  test('non-board lists still show the progress bar', () => {
    expect(src).toMatch(/progress-bar/);
    expect(src).toMatch(/progress-fill/);
  });
});
