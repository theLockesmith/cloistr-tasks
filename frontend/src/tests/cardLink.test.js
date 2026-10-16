/**
 * Per-card deep links (/card/<id>).
 *
 * cardLink.js is pure and tested directly. The wiring in AuthenticatedApp,
 * BoardView and BoardCardModal is checked at source level, matching the
 * project's pattern (no jsdom env). The end-to-end proof that a cold load of
 * /card/<id> opens the card in a real browser lives outside the unit suite.
 */

import fs from 'fs';
import path from 'path';
import { parseCardPath, cardPath, cardUrl, showCardInAddressBar } from '../lib/cardLink';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('parseCardPath', () => {
  test('reads the card id from /card/<id>', () => {
    expect(parseCardPath('/card/231')).toBe(231);
    expect(parseCardPath('/card/231/')).toBe(231);
  });

  test('ignores every other path', () => {
    expect(parseCardPath('/')).toBeNull();
    expect(parseCardPath('')).toBeNull();
    expect(parseCardPath(undefined)).toBeNull();
    expect(parseCardPath('/card/')).toBeNull();
    expect(parseCardPath('/card/abc')).toBeNull();
    expect(parseCardPath('/card/12x')).toBeNull();
    expect(parseCardPath('/card/0')).toBeNull();
    expect(parseCardPath('/card/-4')).toBeNull();
    expect(parseCardPath('/cards/231')).toBeNull();
    expect(parseCardPath('/x/card/231')).toBeNull();
  });

  test('rejects ids past the 32-bit serial range', () => {
    expect(parseCardPath('/card/2147483647')).toBe(2147483647);
    expect(parseCardPath('/card/2147483648')).toBeNull();
    expect(parseCardPath('/card/99999999999')).toBeNull();
  });
});

describe('cardPath / cardUrl', () => {
  test('build the canonical link', () => {
    expect(cardPath(231)).toBe('/card/231');
    expect(cardUrl(231, 'https://tasks.cloistr.xyz')).toBe('https://tasks.cloistr.xyz/card/231');
  });

  test('round-trip through parseCardPath', () => {
    expect(parseCardPath(cardPath(231))).toBe(231);
  });
});

describe('showCardInAddressBar', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    globalThis.window = {
      location: { pathname: '/', search: '?q=bug' },
      history: { replaceState: (_s, _t, url) => calls.push(url) },
    };
  });
  afterEach(() => { delete globalThis.window; });

  test('points at the card and keeps board filters', () => {
    showCardInAddressBar(231);
    expect(calls).toEqual(['/card/231?q=bug']);
  });

  test('goes back to / when the card closes', () => {
    window.location.pathname = '/card/231';
    showCardInAddressBar(null);
    expect(calls).toEqual(['/?q=bug']);
  });

  test('does nothing when already there', () => {
    showCardInAddressBar(null);
    expect(calls).toEqual([]);
  });
});

describe('deep-link wiring', () => {
  const app = read('../components/AuthenticatedApp.js');
  const board = read('../components/BoardView.js');
  const modal = read('../components/BoardCardModal.js');

  test('AuthenticatedApp resolves the card to its board after lists load', () => {
    expect(app).toContain('loadLists().then(openLinkedCard)');
    expect(app).toContain("apiCall('/cards/' + cardId)");
    expect(app).toContain('initialCardId={linkedCardId}');
  });

  test('a card that cannot be opened is reported, not silently dropped', () => {
    expect(app).toMatch(/doesn't exist, or this account can't see it/);
    expect(app).toContain('role="alert"');
    expect(app).toContain('onInitialCardMissing=');
  });

  test('BoardView opens the linked card once the board has loaded', () => {
    expect(board).toMatch(/function BoardView\(\{[^}]*initialCardId[^}]*onInitialCardMissing/);
    expect(board).toContain('initialCardHandled.current = true');
    expect(board).toContain('setSelectedCard({ ...card, _columnName: column.name })');
  });

  test('copy link is offered on the card and in its context menu', () => {
    expect(modal).toContain('copyText(cardUrl(card.id))');
    expect(modal).toContain('Copy link');
    expect(board).toContain("key: 'copy-link'");
    expect(board).toContain('copyText(cardUrl(contextCard.id))');
  });
});
