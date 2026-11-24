/**
 * Escape closes only the top layer (lib/escapeKey.js), and every modal uses
 * it instead of its own document listener. Before, one Escape on an open
 * card also closed the board, and on Edit Task also closed the list.
 */

import fs from 'fs';
import path from 'path';
import { pushEscapeLayer } from '../lib/escapeKey';

function fakeTarget() {
  const listeners = new Set();
  return {
    addEventListener: (type, fn) => type === 'keydown' && listeners.add(fn),
    removeEventListener: (type, fn) => type === 'keydown' && listeners.delete(fn),
    press: (key) => listeners.forEach((fn) => fn({ key })),
    count: () => listeners.size,
  };
}

describe('pushEscapeLayer', () => {
  test('one Escape reaches only the most recent layer', () => {
    const t = fakeTarget();
    const calls = [];
    const offBoard = pushEscapeLayer({ current: () => calls.push('board') }, t);
    const offCard = pushEscapeLayer({ current: () => calls.push('card') }, t);
    t.press('Escape');
    expect(calls).toEqual(['card']);
    offCard();
    t.press('Escape');
    expect(calls).toEqual(['card', 'board']);
    offBoard();
  });

  test('other keys are ignored', () => {
    const t = fakeTarget();
    const calls = [];
    const off = pushEscapeLayer({ current: () => calls.push('x') }, t);
    t.press('Enter');
    expect(calls).toEqual([]);
    off();
  });

  test('removing a lower layer first leaves the top one in charge', () => {
    const t = fakeTarget();
    const calls = [];
    const offA = pushEscapeLayer({ current: () => calls.push('a') }, t);
    const offB = pushEscapeLayer({ current: () => calls.push('b') }, t);
    offA();
    t.press('Escape');
    expect(calls).toEqual(['b']);
    offB();
  });

  test('the document listener is removed with the last layer', () => {
    const t = fakeTarget();
    const off1 = pushEscapeLayer({ current: () => {} }, t);
    const off2 = pushEscapeLayer({ current: () => {} }, t);
    expect(t.count()).toBe(1);
    off2(); off1();
    expect(t.count()).toBe(0);
  });
});

describe('modals use the shared layer, not their own Escape listener', () => {
  const dir = path.resolve(__dirname, '../components');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const escapeUsers = files.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes("'Escape'"));

  test('the stacked views are covered', () => {
    for (const f of ['AuthenticatedApp.js', 'BoardView.js', 'BoardCardModal.js', 'TaskListModal.js', 'EditTaskModal.js']) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).toMatch(/useEscapeKey\(/);
    }
  });

  test.each(files)('%s adds no keydown listener of its own for Escape', (f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!escapeUsers.includes(f) && !src.includes('useEscapeKey')) return;
    expect(src).not.toMatch(/addEventListener\(\s*['"]keydown['"]/);
  });
});
