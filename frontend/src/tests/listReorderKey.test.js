/**
 * Regression test: list reorder must send sortOrder (camelCase) to match
 * the backend PUT /api/lists/:id endpoint.
 *
 * DEFECT (production, 2026-09-10)
 * ────────────────────────────────
 * Drag-reorder looked correct in the UI (optimistic update) but reverted
 * on page reload.  The reorderLists function sent { sort_order: index + 1 }
 * (snake_case), but the backend destructures `sortOrder` (camelCase).
 * toIntOrNull(undefined) returned null, COALESCE(null, sort_order) kept
 * the original value, and the PUT returned 200 with no error.
 *
 * Verified against the production API:
 *   { sort_order: 99 } → sort_order unchanged (silent no-op)
 *   { sortOrder: 99 }  → sort_order = 99 (applied)
 *
 * Fix: change the JSON key from sort_order to sortOrder.
 *
 * WHY A SOURCE-LEVEL ASSERTION:
 * The mismatch is between the key name the frontend sends and the key name
 * the backend destructures.  A unit test that mocks apiCall would need to
 * import the whole AuthenticatedApp component tree, which pulls in React
 * context providers, Nostr auth, and the full DOM.  A source-level check
 * is direct, fast, and catches any regression to the snake_case key.
 */

import fs from 'fs';
import path from 'path';

const componentPath = path.resolve(
  __dirname, '../components/AuthenticatedApp.js',
);
const src = fs.readFileSync(componentPath, 'utf8');

// Extract the reorderLists function body.
function extractReorderLists(source) {
  const start = source.indexOf('const reorderLists');
  if (start === -1) return '';
  // Find the closing of the async arrow function (next top-level `const` or `};`)
  const body = source.slice(start, start + 900);
  return body;
}

const reorderBody = extractReorderLists(src);

describe('List reorder key regression (2026-09-10)', () => {
  test('reorderLists function exists', () => {
    expect(reorderBody).toMatch(/reorderLists/);
  });

  test('reorderLists sends sortOrder (camelCase) in JSON body', () => {
    // The backend PUT /api/lists/:id destructures `sortOrder` (camelCase).
    // This is the key that actually gets written to the database.
    expect(reorderBody).toMatch(/sortOrder:\s*index\s*\+\s*1/);
  });

  test('reorderLists does NOT send sort_order (snake_case) — the broken key', () => {
    // sort_order is silently ignored by the backend (destructured field
    // is undefined, COALESCE keeps the original).  If this key reappears,
    // drag reorder will look correct but revert on reload.
    expect(reorderBody).not.toMatch(/sort_order:\s*index\s*\+\s*1/);
  });

  test('reorderLists calls apiCall with PUT method', () => {
    expect(reorderBody).toMatch(/method:\s*['"]PUT['"]/);
  });

  test('reorderLists targets /lists/ endpoint', () => {
    expect(reorderBody).toMatch(/['"]\/lists\/['"]/);
  });
});
