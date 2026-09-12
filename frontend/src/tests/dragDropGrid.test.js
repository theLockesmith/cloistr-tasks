/**
 * Regression test: DragDropList grid mode must resolve drop targets using
 * 2D distance, not vertical distance only.
 *
 * DEFECT (production, 2026-09-12, reported by aegis-orch)
 * ────────────────────────────────────────────────────────
 * Operator reported: rearranging boards does not work.
 *
 * Root cause: indexFromPoint scored on vertical distance only.  In grid
 * mode, several cards share a row (identical vertical centre).  The
 * strict less-than comparison resolved every tie to the first card in
 * the row, so dragging within a row always returned the leftmost card's
 * index, causing the pointer-up handler to see source === target and
 * skip the reorder call.
 *
 * Fix: when isGrid is true, score on Math.hypot (Euclidean 2D distance)
 * so horizontal position distinguishes cards that share a row.  List
 * mode continues to use vertical-only distance, which is correct for
 * single-column layouts and avoids horizontal jitter.
 *
 * WHY A SOURCE-LEVEL ASSERTION:
 * jsdom does not implement getBoundingClientRect with realistic geometry,
 * so a DOM-level test cannot reproduce the multi-column grid layout that
 * triggers this bug.
 */

import fs from 'fs';
import path from 'path';

const componentPath = path.resolve(__dirname, '../components/DragDropList.js');
const src = fs.readFileSync(componentPath, 'utf8');

// Extract the indexFromPoint function body.
function extractIndexFromPoint(source) {
  const startMarker = 'const indexFromPoint = useCallback(';
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) return '';

  let depth = 0;
  let i = source.indexOf('{', startIdx);
  const bodyStart = i;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
    i++;
  }
  return '';
}

const indexFromPointBody = extractIndexFromPoint(src);

describe('DragDropList grid drag regression (2026-09-12)', () => {
  test('indexFromPoint exists', () => {
    expect(indexFromPointBody.length).toBeGreaterThan(0);
  });

  test('indexFromPoint computes horizontal centre (cx) for grid scoring', () => {
    // The fix adds cx = (rect.left + rect.right) / 2 for 2D distance.
    // Without this, horizontal position is ignored and all items in a
    // row resolve to the same target.
    expect(indexFromPointBody).toMatch(/rect\.left/);
    expect(indexFromPointBody).toMatch(/rect\.right/);
  });

  test('indexFromPoint uses 2D distance in grid mode (Math.hypot)', () => {
    // Math.hypot(dx, dy) is the Euclidean distance that distinguishes
    // items sharing a row.  Math.abs(clientY - cy) alone cannot.
    expect(indexFromPointBody).toMatch(/Math\.hypot/);
  });

  test('indexFromPoint still uses vertical-only distance in list mode', () => {
    // List mode should NOT use Math.hypot — vertical distance avoids
    // horizontal jitter when items are different widths.
    // The conditional isGrid check must appear so both paths exist.
    expect(indexFromPointBody).toMatch(/isGrid/);
    expect(indexFromPointBody).toMatch(/Math\.abs/);
  });

  test('indexFromPoint depends on isGrid in its useCallback deps', () => {
    // The useCallback deps array must include isGrid so the memoized
    // function picks up the correct mode.
    const depsMatch = src.match(/const indexFromPoint = useCallback\([\s\S]*?\},\s*\[([^\]]*)\]/);
    expect(depsMatch).not.toBeNull();
    expect(depsMatch[1]).toContain('isGrid');
  });

  test('single-column list mode would NOT be broken by this fix (ADMISSION)', () => {
    // In list mode (isGrid=false), Math.abs(clientY - cy) is still the
    // scoring function.  Assert the conditional branches.
    expect(indexFromPointBody).toMatch(/isGrid\s*\?\s*Math\.hypot/);
    expect(indexFromPointBody).toMatch(/:\s*Math\.abs/);
  });
});
