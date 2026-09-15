/**
 * BoardView structural tests.
 *
 * BoardView is the Kanban board modal: it loads columns/cards from the API,
 * renders the horizontal column layout, and gates column CUD to admin+
 * while card creation is write-accessible.
 *
 * Source-level structural tests matching the project's established pattern.
 */

import fs from 'fs';
import path from 'path';

const componentPath = path.resolve(
  __dirname, '../components/BoardView.js',
);
const src = fs.readFileSync(componentPath, 'utf8');

// ── Imports and structure ───────────────────────────────────────────────

describe('BoardView imports and exports', () => {
  test('imports BoardCardModal for card detail view', () => {
    expect(src).toMatch(/import\s+BoardCardModal\s+from\s+['"]\.\/BoardCardModal['"]/);
  });

  test('imports access helpers from accessHelpers', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/lib\/accessHelpers['"]/);
  });

  test('exports as default', () => {
    expect(src).toMatch(/export\s+default\s+BoardView/);
  });

  test('accepts list, onClose, apiCall, user props', () => {
    expect(src).toMatch(/function\s+BoardView\(\s*\{[^}]*list[^}]*onClose[^}]*apiCall[^}]*user/);
  });
});

// ── API loading ─────────────────────────────────────────────────────────

describe('board data loading', () => {
  test('calls /boards/:listId to load board data', () => {
    expect(src).toMatch(/apiCall\(\s*['"]\/boards\/['"]\s*\+\s*list\.id\)/);
  });

  test('sets columns and access from response', () => {
    expect(src).toContain('setColumns(data.columns)');
    expect(src).toContain('setAccess(data.access)');
  });

  test('shows loading spinner while fetching', () => {
    expect(src).toMatch(/loading[\s\S]*?spinner/);
    expect(src).toContain('Loading board');
  });

  test('shows error state on failure', () => {
    expect(src).toContain("setError('Failed to load board')");
  });
});

// ── Access control ──────────────────────────────────────────────────────

describe('access control', () => {
  test('derives canWrite from access level (includes admin)', () => {
    expect(src).toMatch(/canWrite\s*=\s*access\s*===\s*['"]owner['"]\s*\|\|\s*access\s*===\s*['"]admin['"]\s*\|\|\s*access\s*===\s*['"]write['"]/);
  });

  test('derives canAdmin from access level', () => {
    expect(src).toMatch(/canAdmin\s*=\s*access\s*===\s*['"]owner['"]\s*\|\|\s*access\s*===\s*['"]admin['"]/);
  });

  test('column creation requires admin (not write)', () => {
    // The "+ Column" button is gated by canAdmin
    const beforeAddCol = src.slice(
      Math.max(0, src.indexOf('+ Column') - 300),
      src.indexOf('+ Column'),
    );
    expect(beforeAddCol).toContain('canAdmin');
  });

  test('column deletion requires admin', () => {
    // Delete button gated by canAdmin
    const beforeDeleteCol = src.slice(
      Math.max(0, src.indexOf('board-column-delete') - 200),
      src.indexOf('board-column-delete'),
    );
    expect(beforeDeleteCol).toContain('canAdmin');
  });

  test('card creation is gated by canWrite', () => {
    expect(src).toMatch(/canWrite\s*&&\s*addingCardColumnId/);
    expect(src).toMatch(/canWrite\s*&&\s*[\s\S]*?board-add-card-btn/);
  });
});

// ── Column rendering ────────────────────────────────────────────────────

describe('column rendering', () => {
  test('maps over columns array', () => {
    expect(src).toMatch(/columns\.map\(\s*column\s*=>/);
  });

  test('shows column name and card count', () => {
    expect(src).toContain('board-column-name');
    expect(src).toContain('board-column-count');
  });

  test('supports column collapse toggle', () => {
    expect(src).toContain('board-collapse-toggle');
    expect(src).toContain('handleToggleCollapse');
    expect(src).toMatch(/column\.collapsed/);
  });

  test('hides cards when column is collapsed', () => {
    expect(src).toMatch(/!column\.collapsed\s*&&/);
  });
});

// ── Card rendering ──────────────────────────────────────────────────────

describe('card rendering', () => {
  test('maps over column.cards array', () => {
    expect(src).toMatch(/\(column\.cards\s*\|\|\s*\[\]\)(?:\.filter\([^)]*\))?\.map\(\s*card\s*=>/);
  });

  test('card click opens detail modal via setSelectedCard', () => {
    expect(src).toMatch(/onClick=\{.*setSelectedCard/);
  });

  test('shows card title', () => {
    expect(src).toContain('board-card-title');
    expect(src).toContain('card.title');
  });

  test('shows priority badge for high-priority cards', () => {
    expect(src).toContain('board-card-priority');
    expect(src).toMatch(/card\.priority\s*&&\s*card\.priority\s*<=\s*5/);
  });

  test('shows due date with color formatting', () => {
    expect(src).toContain('formatDate');
    expect(src).toContain('card.due_date');
  });

  test('shows assignee indicator', () => {
    expect(src).toContain('board-card-assignee');
    expect(src).toContain('card.assignee_pubkey');
  });
});

// ── Card detail modal ───────────────────────────────────────────────────

describe('card detail modal', () => {
  test('renders BoardCardModal when selectedCard is set', () => {
    expect(src).toMatch(/selectedCard\s*&&[\s\S]*?<BoardCardModal/);
  });

  test('passes card, columns, listId, access, apiCall, user to BoardCardModal', () => {
    const modalSection = src.slice(
      src.indexOf('<BoardCardModal'),
      src.indexOf('<BoardCardModal') + 400,
    );
    expect(modalSection).toMatch(/card=\{selectedCard\}/);
    expect(modalSection).toMatch(/columns=\{columns\}/);
    expect(modalSection).toMatch(/listId=\{list\.id\}/);
    expect(modalSection).toMatch(/access=\{access\}/);
    expect(modalSection).toMatch(/apiCall=\{apiCall\}/);
    expect(modalSection).toMatch(/user=\{user\}/);
  });

  test('onCardUpdated reloads board and closes modal', () => {
    const modalSection = src.slice(
      src.indexOf('<BoardCardModal'),
      src.indexOf('<BoardCardModal') + 400,
    );
    expect(modalSection).toContain('setSelectedCard(null)');
    expect(modalSection).toContain('loadBoard()');
  });
});

// ── Escape key handling ─────────────────────────────────────────────────

describe('escape key handling', () => {
  test('registers keydown listener for Escape', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]keydown['"]/);
    expect(src).toMatch(/removeEventListener\(\s*['"]keydown['"]/);
  });

  test('escape priority: card modal > add card > add column > close board', () => {
    // Find the escape handler block
    const escIdx = src.indexOf("'Escape'");
    const escBlock = src.slice(escIdx, escIdx + 500);
    const selectedCardIdx = escBlock.indexOf('selectedCard');
    const addingCardIdx = escBlock.indexOf('addingCardColumnId');
    const addingColumnIdx = escBlock.indexOf('addingColumn');
    const onCloseIdx = escBlock.indexOf('onClose');

    expect(selectedCardIdx).toBeGreaterThan(-1);
    expect(selectedCardIdx).toBeLessThan(addingCardIdx);
    expect(addingCardIdx).toBeLessThan(addingColumnIdx);
    expect(addingColumnIdx).toBeLessThan(onCloseIdx);
  });
});

// ── Add card form ───────────────────────────────────────────────────────

describe('add card form', () => {
  test('has add card form with board-add-card-form class', () => {
    expect(src).toContain('board-add-card-form');
  });

  test('submits via handleAddCard with columnId', () => {
    expect(src).toContain('handleAddCard(column.id)');
  });

  test('posts to /boards/:listId/cards', () => {
    expect(src).toMatch(/apiCall\(\s*['"]\/boards\/['"]\s*\+\s*list\.id\s*\+\s*['"]\/cards['"]/);
  });

  test('cancel button clears form state', () => {
    expect(src).toMatch(/setAddingCardColumnId\(null\)/);
    expect(src).toMatch(/setNewCardTitle\(['"]{2}\)/);
  });
});

// ── Add column form ─────────────────────────────────────────────────────

describe('add column form', () => {
  test('new column form has board-column-new class', () => {
    expect(src).toContain('board-column-new');
  });

  test('posts to /boards/:listId/columns', () => {
    expect(src).toMatch(/apiCall\(\s*['"]\/boards\/['"]\s*\+\s*list\.id\s*\+\s*['"]\/columns['"]/);
  });

  test('cancel button resets addingColumn state', () => {
    expect(src).toMatch(/setAddingColumn\(false\)/);
    expect(src).toMatch(/setNewColumnName\(['"]{2}\)/);
  });
});

// ── Board header ────────────────────────────────────────────────────────

describe('board header', () => {
  test('shows board name in header', () => {
    expect(src).toContain('board-header');
    // BoardView tracks the board name in local state (boardName) so it can
    // update the display after a rename without re-fetching the parent.
    expect(src).toMatch(/\{boardName\}/);
  });

  test('shows list icon with color', () => {
    expect(src).toContain('list-icon');
    expect(src).toMatch(/list\.color\s*\|\|\s*['"]var\(--primary\)['"]/);
  });

  test('has close button', () => {
    expect(src).toMatch(/onClick=\{onClose\}[\s\S]*?Close/);
  });
});

// ── Board tags ─────────────────────────────────────────────────────────

describe('board tags', () => {
  test('tracks boardTags state', () => {
    expect(src).toContain('boardTags');
    expect(src).toContain('setBoardTags');
  });

  test('loads tags from board API response', () => {
    expect(src).toContain('data.tags');
  });

  test('renders tag pills on cards', () => {
    expect(src).toContain('board-card-tags');
    expect(src).toContain('board-card-tag-pill');
  });

  test('passes boardTags to BoardCardModal', () => {
    const modalSection = src.slice(
      src.indexOf('<BoardCardModal'),
      src.indexOf('<BoardCardModal') + 500,
    );
    expect(modalSection).toContain('boardTags={boardTags}');
  });
});

// ── Client-side card filters ──────────────────────────────────────────

describe('card filters', () => {
  test('filter state initialized from URL search params', () => {
    expect(src).toContain("new URLSearchParams(window.location.search)");
    expect(src).toContain("params.get('q')");
    expect(src).toContain("params.get('assignee')");
    expect(src).toContain("params.get('opener')");
    expect(src).toContain("params.get('tags')");
  });

  test('syncFiltersToUrl writes filter state to URL via replaceState', () => {
    expect(src).toContain('syncFiltersToUrl');
    expect(src).toContain('window.history.replaceState');
  });

  test('matchesFilter checks text, assignee, opener, and tags', () => {
    expect(src).toContain('matchesFilter');
    expect(src).toMatch(/card\.title\.toLowerCase\(\)\.includes\(filterText/);
    expect(src).toContain('filterAssignee');
    expect(src).toContain('filterOpener');
    expect(src).toContain('filterTags');
  });

  test('cards are filtered before rendering', () => {
    expect(src).toMatch(/\.filter\(matchesFilter\)\.map\(\s*card/);
  });

  test('unassigned is a selectable assignee value', () => {
    expect(src).toContain("'_unassigned'");
    expect(src).toContain('Unassigned');
  });

  test('filter bar renders between header and container', () => {
    const headerEnd = src.indexOf('board-header-actions');
    const filterBar = src.indexOf('board-filter-bar');
    const container = src.indexOf('board-container');
    expect(filterBar).toBeGreaterThan(headerEnd);
    expect(filterBar).toBeLessThan(container);
  });

  test('filter bar has text input, assignee select, opener select', () => {
    expect(src).toContain('board-filter-text');
    expect(src).toContain('board-filter-assignee');
    expect(src).toContain('board-filter-opener');
    expect(src).toContain('Search cards...');
    expect(src).toContain('All assignees');
    expect(src).toContain('All openers');
  });

  test('tag filter uses select dropdown to add tags', () => {
    expect(src).toContain('board-filter-tag');
    expect(src).toContain('Add tag filter...');
  });

  test('clear button appears when filtering', () => {
    expect(src).toContain('board-filter-clear');
    expect(src).toContain('isFiltering');
    expect(src).toContain('Clear');
  });

  test('isFiltering derived from any active filter', () => {
    expect(src).toMatch(/isFiltering\s*=\s*filterText\s*\|\|\s*filterAssignee\s*\|\|\s*filterOpener\s*\|\|\s*filterTags\.length/);
  });

  test('unique assignees and openers are memoized from all cards', () => {
    expect(src).toContain('uniqueAssignees');
    expect(src).toContain('uniqueOpeners');
    expect(src).toMatch(/useMemo\(\(\)\s*=>\s*columns\.flatMap/);
  });
});

// ── Checklist rollup on card face ─────────────────────────────────────

describe('checklist rollup', () => {
  test('shows checklist progress badge on cards', () => {
    expect(src).toContain('board-card-checklist-badge');
    expect(src).toContain('card.checklist');
  });

  test('badge shows done/total counts', () => {
    expect(src).toContain('card.checklist.done');
    expect(src).toContain('card.checklist.total');
  });
});
