/**
 * BoardCardModal structural tests.
 *
 * BoardCardModal is the card detail view with editable fields, column move,
 * and a threaded comment section.  Write access gates editing; admin access
 * gates deletion.  Comments are author-only for edit/delete.
 *
 * Source-level structural tests matching the project's established pattern.
 */

import fs from 'fs';
import path from 'path';

const componentPath = path.resolve(
  __dirname, '../components/BoardCardModal.js',
);
const src = fs.readFileSync(componentPath, 'utf8');

// ── Structure ───────────────────────────────────────────────────────────

describe('BoardCardModal structure', () => {
  test('exports as default', () => {
    expect(src).toMatch(/export\s+default\s+BoardCardModal/);
  });

  test('accepts card, columns, listId, access, apiCall, user, onClose, onCardUpdated props', () => {
    expect(src).toMatch(
      /function\s+BoardCardModal\(\s*\{[^}]*card[^}]*columns[^}]*listId[^}]*access[^}]*apiCall[^}]*user[^}]*onClose[^}]*onCardUpdated/,
    );
  });
});

// ── Access control ──────────────────────────────────────────────────────

describe('access control', () => {
  test('derives canWrite from owner, admin, or write access', () => {
    expect(src).toMatch(/canWrite\s*=\s*access\s*===\s*['"]owner['"]\s*\|\|\s*access\s*===\s*['"]admin['"]\s*\|\|\s*access\s*===\s*['"]write['"]/);
  });

  test('derives canAdmin from owner or admin access', () => {
    expect(src).toMatch(/canAdmin\s*=\s*access\s*===\s*['"]owner['"]\s*\|\|\s*access\s*===\s*['"]admin['"]/);
  });

  test('card deletion requires admin access', () => {
    // Delete Card button is inside a canAdmin guard
    const deleteBtnIdx = src.indexOf('Delete Card');
    const beforeDelete = src.slice(
      Math.max(0, deleteBtnIdx - 200),
      deleteBtnIdx,
    );
    expect(beforeDelete).toContain('canAdmin');
  });

  test('editable title field gated by canWrite', () => {
    const titleInputIdx = src.indexOf('board-card-title-input');
    const beforeTitle = src.slice(
      Math.max(0, titleInputIdx - 200),
      titleInputIdx,
    );
    expect(beforeTitle).toContain('canWrite');
  });

  test('comment form gated by canWrite', () => {
    const commentFormIdx = src.indexOf('comment-input-form');
    const beforeForm = src.slice(
      Math.max(0, commentFormIdx - 200),
      commentFormIdx,
    );
    expect(beforeForm).toContain('canWrite');
  });
});

// ── Card fields ─────────────────────────────────────────────────────────

describe('card fields', () => {
  test('has title input with board-card-title-input class', () => {
    expect(src).toContain('board-card-title-input');
  });

  test('has description textarea', () => {
    expect(src).toMatch(/placeholder="Add a description\.\.\."/);
  });

  test('has priority select with options 1-10', () => {
    expect(src).toMatch(/\[1,2,3,4,5,6,7,8,9,10\]\.map/);
  });

  test('has due date input', () => {
    expect(src).toMatch(/type="date"/);
    expect(src).toContain('dueDate');
  });

  test('shows read-only description when not canWrite', () => {
    expect(src).toContain('board-card-desc-ro');
  });
});

// ── Dirty tracking and save ─────────────────────────────────────────────

describe('dirty tracking and save', () => {
  test('tracks dirty state for unsaved changes', () => {
    expect(src).toMatch(/useState\(false\)/);
    expect(src).toContain('setDirty(true)');
  });

  test('save button only appears when dirty', () => {
    expect(src).toMatch(/dirty\s*&&/);
    expect(src).toContain('Save Changes');
  });

  test('save sends PUT to /boards/:listId/cards/:cardId', () => {
    expect(src).toMatch(/apiCall\(\s*['"]\/boards\/['"]\s*\+\s*listId\s*\+\s*['"]\/cards\/['"]\s*\+\s*card\.id/);
    expect(src).toMatch(/method:\s*['"]PUT['"]/);
  });

  test('save clears dirty flag on success', () => {
    expect(src).toContain('setDirty(false)');
  });

  test('save calls onCardUpdated on success', () => {
    // The handleSave function calls onCardUpdated()
    const saveSection = src.slice(
      src.indexOf('handleSave'),
      src.indexOf('handleSave') + 700,
    );
    expect(saveSection).toContain('onCardUpdated()');
  });
});

// ── Column move ─────────────────────────────────────────────────────────

describe('column move', () => {
  test('has move-to-column select from columns prop', () => {
    expect(src).toContain('Move to Column');
    expect(src).toMatch(/columns\.map\(\s*col\s*=>/);
  });

  test('posts move to /boards/:listId/cards/:cardId/move', () => {
    expect(src).toMatch(/\/cards\/['"]\s*\+\s*card\.id\s*\+\s*['"]\/move/);
    expect(src).toMatch(/method:\s*['"]POST['"]/);
    expect(src).toMatch(/columnId:\s*Number\(newColumnId\)/);
  });
});

// ── Card deletion ───────────────────────────────────────────────────────

describe('card deletion', () => {
  test('shows confirmation dialog before delete', () => {
    expect(src).toMatch(/window\.confirm\(\s*['"]Delete this card/);
  });

  test('sends DELETE to /boards/:listId/cards/:cardId', () => {
    const deleteSection = src.slice(
      src.indexOf('handleDelete'),
      src.indexOf('handleDelete') + 300,
    );
    expect(deleteSection).toMatch(/method:\s*['"]DELETE['"]/);
  });

  test('calls onCardUpdated after deletion (closes modal)', () => {
    const deleteSection = src.slice(
      src.indexOf('handleDelete'),
      src.indexOf('handleDelete') + 300,
    );
    expect(deleteSection).toContain('onCardUpdated()');
  });
});

// ── Comments ────────────────────────────────────────────────────────────

describe('comments section', () => {
  test('loads comments on mount via /boards/:listId/cards/:cardId/comments', () => {
    expect(src).toMatch(/\/cards\/['"]\s*\+\s*card\.id\s*\+\s*['"]\/comments/);
    expect(src).toContain('loadComments');
  });

  test('shows comment count in heading', () => {
    expect(src).toMatch(/Comments\s*\(\{comments\.length\}\)/);
  });

  test('shows empty state when no comments', () => {
    expect(src).toContain('No comments yet');
  });

  test('renders comment author, timestamp, and body', () => {
    expect(src).toContain('comment-author');
    expect(src).toContain('comment-time');
    expect(src).toContain('comment-body');
  });

  test('shows author_label if present, otherwise truncated pubkey', () => {
    expect(src).toMatch(/comment\.author_label\s*\|\|\s*truncatePubkey/);
  });

  test('edit/delete buttons only for own comments', () => {
    expect(src).toMatch(/comment\.author_pubkey\s*===\s*user\?\.\s*pubkey/);
  });
});

// ── Comment create ──────────────────────────────────────────────────────

describe('comment creation', () => {
  test('has comment input form', () => {
    expect(src).toContain('comment-input-form');
    expect(src).toMatch(/placeholder="Write a comment\.\.\."/);
  });

  test('submit button disabled when empty', () => {
    expect(src).toMatch(/disabled=\{!newComment\.trim\(\)\}/);
  });

  test('posts comment body to API', () => {
    expect(src).toMatch(/body:\s*newComment\.trim\(\)/);
  });

  test('clears input and reloads comments on success', () => {
    const addSection = src.slice(
      src.indexOf('handleAddComment'),
      src.indexOf('handleAddComment') + 400,
    );
    expect(addSection).toContain("setNewComment('')");
    expect(addSection).toContain('loadComments()');
  });
});

// ── Comment edit ────────────────────────────────────────────────────────

describe('comment editing', () => {
  test('edit button sets editingCommentId and body', () => {
    expect(src).toContain('setEditingCommentId(comment.id)');
    expect(src).toContain('setEditingCommentBody(comment.body)');
  });

  test('edit form has save and cancel buttons', () => {
    expect(src).toContain('comment-edit-form');
  });

  test('sends PUT to /boards/:listId/comments/:commentId', () => {
    expect(src).toMatch(/\/comments\/['"]\s*\+\s*commentId/);
    const editSection = src.slice(
      src.indexOf('handleEditComment'),
      src.indexOf('handleEditComment') + 400,
    );
    expect(editSection).toMatch(/method:\s*['"]PUT['"]/);
  });

  test('cancel clears editing state', () => {
    expect(src).toMatch(/setEditingCommentId\(null\)/);
    expect(src).toMatch(/setEditingCommentBody\(['"]{2}\)/);
  });
});

// ── Comment delete ──────────────────────────────────────────────────────

describe('comment deletion', () => {
  test('sends DELETE to /boards/:listId/comments/:commentId', () => {
    const deleteSection = src.slice(
      src.indexOf('handleDeleteComment'),
      src.indexOf('handleDeleteComment') + 300,
    );
    expect(deleteSection).toMatch(/method:\s*['"]DELETE['"]/);
  });

  test('reloads comments after deletion', () => {
    const deleteSection = src.slice(
      src.indexOf('handleDeleteComment'),
      src.indexOf('handleDeleteComment') + 300,
    );
    expect(deleteSection).toContain('loadComments()');
  });
});

// ── Priority labels ─────────────────────────────────────────────────────

describe('priority label helper', () => {
  test('returns P1 Critical for priority 1', () => {
    expect(src).toContain('P1 Critical');
  });

  test('returns P2 High for priority 2', () => {
    expect(src).toContain('P2 High');
  });

  test('returns P3 Medium for priority 3', () => {
    expect(src).toContain('P3 Medium');
  });
});

// ── Expandable comments ─────────────────────────────────────────────────

describe('expandable comments', () => {
  test('tracks expandedCommentId state', () => {
    expect(src).toContain('expandedCommentId');
    expect(src).toContain('setExpandedCommentId');
  });

  test('long comments are clickable to expand (threshold > 120 chars)', () => {
    expect(src).toMatch(/comment\.body\.length\s*>\s*120/);
    expect(src).toContain("'Click to expand'");
  });

  test('expanded comment overlay reuses the description overlay CSS class', () => {
    const expandedOverlayCount = (src.match(/board-card-desc-expanded-overlay/g) || []).length;
    expect(expandedOverlayCount).toBeGreaterThanOrEqual(2);
  });

  test('expanded comment shows author and timestamp', () => {
    const overlaySection = src.slice(src.lastIndexOf('board-card-desc-expanded-overlay'));
    expect(overlaySection).toContain('comment-author');
    expect(overlaySection).toContain('comment-time');
  });

  test('expanded comment has a close button', () => {
    const lastOverlay = src.slice(src.lastIndexOf('board-card-desc-expanded-overlay'));
    expect(lastOverlay).toContain('setExpandedCommentId(null)');
  });
});

// ── Escape key ──────────────────────────────────────────────────────────

describe('escape key handling', () => {
  test('escape closes expanded comment first, then description, then editing, then modal', () => {
    const escIdx = src.indexOf("'Escape'");
    const escBlock = src.slice(escIdx, escIdx + 400);
    const expandedCommentIdx = escBlock.indexOf('expandedCommentId');
    const descExpandedIdx = escBlock.indexOf('descriptionExpanded');
    const editingIdx = escBlock.indexOf('editingCommentId');
    const onCloseIdx = escBlock.indexOf('onClose');

    expect(expandedCommentIdx).toBeGreaterThan(-1);
    expect(expandedCommentIdx).toBeLessThan(descExpandedIdx);
    expect(descExpandedIdx).toBeLessThan(editingIdx);
    expect(editingIdx).toBeLessThan(onCloseIdx);
  });

  test('cleans up keydown listener on unmount', () => {
    expect(src).toMatch(/removeEventListener\(\s*['"]keydown['"]/);
  });
});

// ── Board tags ─────────────────────────────────────────────────────────

describe('board tags', () => {
  test('accepts boardTags prop', () => {
    expect(src).toMatch(
      /function\s+BoardCardModal\(\s*\{[^}]*boardTags/,
    );
  });

  test('tracks cardTags state from card.tags', () => {
    expect(src).toContain('cardTags');
    expect(src).toContain('setCardTags');
    expect(src).toMatch(/useState\(card\.tags\s*\|\|\s*\[\]\)/);
  });

  test('attach tag posts to /boards/:listId/cards/:cardId/tags', () => {
    expect(src).toMatch(/\/cards\/['"]\s*\+\s*card\.id\s*\+\s*['"]\/tags/);
    const attachSection = src.slice(
      src.indexOf('handleAttachTag'),
      src.indexOf('handleAttachTag') + 400,
    );
    expect(attachSection).toMatch(/method:\s*['"]POST['"]/);
    expect(attachSection).toContain('tagId');
  });

  test('detach tag sends DELETE to /cards/:cardId/tags/:tagId', () => {
    const detachSection = src.slice(
      src.indexOf('handleDetachTag'),
      src.indexOf('handleDetachTag') + 400,
    );
    expect(detachSection).toMatch(/method:\s*['"]DELETE['"]/);
  });

  test('create tag posts to /boards/:listId/tags (admin)', () => {
    const createSection = src.slice(
      src.indexOf('handleCreateTag'),
      src.indexOf('handleCreateTag') + 400,
    );
    expect(createSection).toMatch(/method:\s*['"]POST['"]/);
    expect(createSection).toContain('newTagName');
  });

  test('delete tag sends DELETE to /boards/:listId/tags/:tagId (admin)', () => {
    const deleteSection = src.slice(
      src.indexOf('handleDeleteTag'),
      src.indexOf('handleDeleteTag') + 400,
    );
    expect(deleteSection).toMatch(/method:\s*['"]DELETE['"]/);
  });

  test('manage tags UI gated by canAdmin', () => {
    expect(src).toContain('showManageTags');
    expect(src).toContain('Manage Tags');
  });
});

// ── Markdown rendering ─────────────────────────────────────────────

describe('markdown rendering', () => {
  test('imports renderMarkdown from lib', () => {
    expect(src).toMatch(/import\s+renderMarkdown\s+from\s+['"]\.\.\/lib\/renderMarkdown['"]/);
  });

  test('read-only description uses renderMarkdown with dangerouslySetInnerHTML', () => {
    expect(src).toMatch(/board-card-desc-ro[\s\S]*?md-rendered/);
    expect(src).toMatch(/dangerouslySetInnerHTML[\s\S]*?renderMarkdown\(description\)/);
  });

  test('comment body uses renderMarkdown with dangerouslySetInnerHTML', () => {
    expect(src).toMatch(/comment-body[\s\S]*?md-rendered/);
    expect(src).toMatch(/renderMarkdown\(comment\.body\)/);
  });

  test('expanded description overlay uses renderMarkdown', () => {
    const expandedOverlays = src.split('board-card-desc-expanded-overlay');
    const hasRender = expandedOverlays.some(s => s.includes('renderMarkdown(description)'));
    expect(hasRender).toBe(true);
  });

  test('expanded comment overlay uses renderMarkdown', () => {
    expect(src).toMatch(/renderMarkdown\(c\.body\)/);
  });
});

// ── Markdown rendering ─────────────────────────────────────────────────

describe('markdown rendering', () => {
  test('imports renderMarkdown', () => {
    expect(src).toMatch(/import\s+renderMarkdown\s+from\s+['"]\.\.\/lib\/renderMarkdown['"]/);
  });

  test('read-only description uses dangerouslySetInnerHTML with renderMarkdown', () => {
    expect(src).toMatch(/board-card-desc-ro[\s\S]*?dangerouslySetInnerHTML[\s\S]*?renderMarkdown\(description\)/);
  });

  test('comment bodies use dangerouslySetInnerHTML with renderMarkdown', () => {
    expect(src).toMatch(/comment-body[\s\S]*?dangerouslySetInnerHTML[\s\S]*?renderMarkdown\(comment\.body\)/);
  });

  test('expanded comment uses renderMarkdown too', () => {
    const expandedOverlay = src.slice(src.lastIndexOf('board-card-desc-expanded-overlay'));
    expect(expandedOverlay).toContain('renderMarkdown');
  });

  test('description and comments get md-rendered class', () => {
    const mdRenderedCount = (src.match(/md-rendered/g) || []).length;
    expect(mdRenderedCount).toBeGreaterThanOrEqual(3);
  });
});

// ── Column badge ────────────────────────────────────────────────────────

describe('column badge', () => {
  test('shows current column name as badge', () => {
    expect(src).toContain('board-card-column-badge');
    expect(src).toContain('currentColumn');
  });
});

// ── Timestamp formatting ────────────────────────────────────────────────

describe('timestamp formatting', () => {
  test('has formatTimestamp helper', () => {
    expect(src).toContain('formatTimestamp');
  });

  test('shows "just now" for recent timestamps', () => {
    expect(src).toContain("'just now'");
  });

  test('shows relative minutes and hours', () => {
    expect(src).toMatch(/diffMins\s*\+\s*['"]m ago['"]/);
    expect(src).toMatch(/diffHrs\s*\+\s*['"]h ago['"]/);
  });
});

// ── Checklist ──────────────────────────────────────────────────────────

describe('checklist', () => {
  test('tracks checklistItems and newChecklistText state', () => {
    expect(src).toContain('checklistItems');
    expect(src).toContain('setChecklistItems');
    expect(src).toContain('newChecklistText');
  });

  test('loads checklist on mount via /boards/:listId/cards/:cardId/checklist', () => {
    expect(src).toContain('loadChecklist');
    expect(src).toMatch(/\/cards\/['"]\s*\+\s*card\.id\s*\+\s*['"]\/checklist/);
  });

  test('add item posts text to checklist endpoint', () => {
    const addSection = src.slice(
      src.indexOf('handleAddChecklistItem'),
      src.indexOf('handleAddChecklistItem') + 500,
    );
    expect(addSection).toMatch(/method:\s*['"]POST['"]/);
    expect(addSection).toContain('newChecklistText');
  });

  test('toggle sends PUT with flipped done flag', () => {
    const toggleSection = src.slice(
      src.indexOf('handleToggleChecklistItem'),
      src.indexOf('handleToggleChecklistItem') + 400,
    );
    expect(toggleSection).toMatch(/method:\s*['"]PUT['"]/);
    expect(toggleSection).toContain('!done');
  });

  test('delete sends DELETE for checklist item', () => {
    const deleteSection = src.slice(
      src.indexOf('handleDeleteChecklistItem'),
      src.indexOf('handleDeleteChecklistItem') + 300,
    );
    expect(deleteSection).toMatch(/method:\s*['"]DELETE['"]/);
  });

  test('renders checklist-items list with checkboxes', () => {
    expect(src).toContain('checklist-items');
    expect(src).toContain('checklist-item');
    expect(src).toMatch(/type="checkbox"/);
  });

  test('shows progress count and bar', () => {
    expect(src).toContain('checklist-progress');
    expect(src).toContain('checklist-progress-bar');
    expect(src).toMatch(/checklistItems\.filter\(i\s*=>\s*i\.done\)\.length/);
  });

  test('add form gated by canWrite', () => {
    expect(src).toContain('checklist-add-form');
    const formIdx = src.indexOf('checklist-add-form');
    const beforeForm = src.slice(Math.max(0, formIdx - 200), formIdx);
    expect(beforeForm).toContain('canWrite');
  });
});
