/**
 * Regression test: DragDropList must not swallow clicks on child elements.
 *
 * DEFECT (production, 2026-09-09)
 * ────────────────────────────────
 * Operator reported: "Clicking on task lists does nothing."
 *
 * Root cause: DragDropList.handlePointerDown called setPointerCapture on
 * every pointerdown, even a simple click.  In modern browsers, pointer
 * capture redirects the click event to the capturing element (the drag
 * wrapper), so onClick on child elements (the list-card divs) never fired.
 *
 * Fix: defer setPointerCapture to handlePointerMove, after the pointer
 * moves past DRAG_THRESHOLD_PX.  A click (no movement) never captures.
 *
 * WHY A SOURCE-LEVEL ASSERTION:
 * jsdom does not implement setPointerCapture, so a DOM-level test cannot
 * reproduce the browser behavior.  This test asserts the fix at the source
 * level: setPointerCapture must appear inside handlePointerMove (behind a
 * threshold), never inside handlePointerDown.  A companion Playwright test
 * (scratchpad/test-pointer-capture.js) verifies the behavior in a real
 * browser.
 *
 * ADMISSION INVARIANT: the test asserts that the legitimate actor (a user
 * clicking a list card) CAN get through.  A test that only checks refusal
 * would pass with a component that refuses everyone.
 */

import fs from 'fs';
import path from 'path';

const componentPath = path.resolve(__dirname, '../components/DragDropList.js');
const src = fs.readFileSync(componentPath, 'utf8');

// Split the source into the handlePointerDown and handlePointerMove bodies.
// The component uses useCallback, so each handler is a distinct arrow function.
function extractHandler(source, name) {
  // Match: const <name> = useCallback((...) => { ... }, [...]);
  const re = new RegExp(
    'const\\s+' + name + '\\s*=\\s*useCallback\\(([\\s\\S]*?)\\},\\s*\\[',
  );
  const m = source.match(re);
  return m ? m[1] : '';
}

const pointerDownBody = extractHandler(src, 'handlePointerDown');
const pointerMoveBody = extractHandler(src, 'handlePointerMove');

describe('DragDropList click regression (2026-09-09)', () => {
  test('setPointerCapture must NOT be called inside handlePointerDown', () => {
    // This is the exact line that caused the bug.  If it reappears in
    // handlePointerDown, clicks on child elements will be swallowed.
    expect(pointerDownBody).not.toMatch(/setPointerCapture/);
  });

  test('setPointerCapture IS called inside handlePointerMove (ADMISSION: drag still works)', () => {
    // Without setPointerCapture somewhere, touch drag-drop breaks.
    // It belongs in handlePointerMove, behind a drag threshold.
    expect(pointerMoveBody).toMatch(/setPointerCapture/);
  });

  test('a drag threshold constant exists and is positive', () => {
    const thresholdMatch = src.match(/DRAG_THRESHOLD_PX\s*=\s*(\d+)/);
    expect(thresholdMatch).not.toBeNull();
    expect(Number(thresholdMatch[1])).toBeGreaterThan(0);
  });

  test('handlePointerDown records intent but does not start a drag', () => {
    // The handler should set a pending ref, not call setDraggedIndex directly.
    expect(pointerDownBody).not.toMatch(/setDraggedIndex\(/);
    expect(pointerDownBody).toMatch(/pendingDrag/);
  });

  test('handlePointerMove checks threshold before starting drag', () => {
    // The move handler must compare distance to the threshold before
    // promoting to a real drag.
    expect(pointerMoveBody).toMatch(/DRAG_THRESHOLD_PX/);
  });
});
