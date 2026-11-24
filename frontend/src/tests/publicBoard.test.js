/**
 * Public board page (/public/board/<id>, TASKS-49).
 *
 * publicBoard.js and cardFace.js are pure and tested directly. The wiring is
 * checked at source level, matching the project's pattern (no jsdom env).
 * The server side (private refused, public minimal) is covered by
 * backend/tests/integration/public-board-page.test.js; the real-browser proof
 * runs against the live site.
 */

import fs from 'fs';
import path from 'path';
import { parsePublicBoardPath, publicBoardPath, publicBoardUrl } from '../lib/publicBoard';
import { priorityColor, dueLabel } from '../lib/cardFace';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('parsePublicBoardPath', () => {
  test('reads the board id from /public/board/<id>', () => {
    expect(parsePublicBoardPath('/public/board/12')).toBe(12);
    expect(parsePublicBoardPath('/public/board/12/')).toBe(12);
  });

  test('ignores every other path', () => {
    for (const p of ['/', '', undefined, '/public/board/', '/public/board/abc',
      '/public/board/0', '/public/board/-3', '/board/12', '/card/12', '/x/public/board/12',
      '/public/board/2147483648']) {
      expect(parsePublicBoardPath(p)).toBeNull();
    }
  });

  test('builds the path and full URL', () => {
    expect(publicBoardPath(7)).toBe('/public/board/7');
    expect(publicBoardUrl(7, 'https://tasks.example')).toBe('https://tasks.example/public/board/7');
  });
});

describe('card face helpers', () => {
  test('priority colours', () => {
    expect(priorityColor(1)).toBe('var(--error)');
    expect(priorityColor(3)).toBe('var(--warning)');
    expect(priorityColor(5)).toBe('#eab308');
  });

  test('due labels by whole calendar day', () => {
    const now = new Date(2026, 10, 24, 23, 30);
    expect(dueLabel('2026-11-23', now).level).toBe('overdue');
    expect(dueLabel('2026-11-24', now).text).toBe('Today');
    expect(dueLabel('2026-11-25T00:00:00.000Z', now).text).toBe('Tomorrow');
    expect(dueLabel('2026-12-24', now).level).toBe('later');
    expect(dueLabel(null, now)).toBeNull();
  });
});

describe('wiring', () => {
  const app = read('../App.js');
  const view = read('../components/PublicBoardView.js');
  const editList = read('../components/EditListModal.js');
  const board = read('../components/BoardView.js');

  test('App renders the public page before any auth provider mounts', () => {
    const appFn = app.slice(app.indexOf('function App()'));
    const routeAt = appFn.indexOf('parsePublicBoardPath(window.location.pathname)');
    const viewAt = appFn.indexOf('<PublicBoardView');
    const authAt = appFn.indexOf('<SharedAuthProvider');
    expect(routeAt).toBeGreaterThan(-1);
    expect(viewAt).toBeGreaterThan(routeAt);
    expect(viewAt).toBeLessThan(authAt);
  });

  test('the page asks the server for the signed-out view, never with credentials', () => {
    expect(view).toMatch(/fetch\(`\$\{API_BASE\}\/public\/boards\/\$\{boardId\}`, \{ credentials: 'omit' \}\)/);
  });

  test('the page shows nothing about people', () => {
    expect(view).not.toMatch(/pubkey|assignee|author/i);
  });

  test('a private or missing board gets one plain message', () => {
    expect(view).toContain('res.status === 404');
    expect(view).toContain('This board does not exist, or its owner has not made it public.');
  });

  test('board settings offer the public link only once the board is saved as public', () => {
    expect(editList).toContain("list.visibility === 'public' && formData.visibility === 'public'");
    expect(editList).toContain('publicBoardUrl(list.id)');
  });

  test('the board and the public page share the card face helpers', () => {
    expect(board).toContain("from '../lib/cardFace'");
    expect(view).toContain("from '../lib/cardFace'");
  });
});
