import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import BoardCardModal from './BoardCardModal';
import { useCardContextMenu, CardContextMenu } from './CardContextMenu';
import DragDropList from './DragDropList';
import EditListModal from './EditListModal';
import { isListOwner, canAdminList, canWriteList } from '../lib/accessHelpers';
import { formatPubkey } from '../lib/pubkeyDisplay';

function BoardView({ list, onClose, apiCall, user }) {
  const [columns, setColumns] = useState([]);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [addingCardColumnId, setAddingCardColumnId] = useState(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [editingColumnId, setEditingColumnId] = useState(null);
  const [editingColumnName, setEditingColumnName] = useState('');
  const [showEditBoard, setShowEditBoard] = useState(false);
  const [boardName, setBoardName] = useState(list.name);
  const [boardDescription, setBoardDescription] = useState(list.description);
  const [dropTargetColumnId, setDropTargetColumnId] = useState(null);
  const [contextCard, setContextCard] = useState(null);
  const [boardTags, setBoardTags] = useState([]);
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const cardMenu = useCardContextMenu();

  // Filter state, synced to URL query string so filtered views are shareable.
  const params = new URLSearchParams(window.location.search);
  const [filterText, setFilterText] = useState(params.get('q') || '');
  const [filterAssignee, setFilterAssignee] = useState(params.get('assignee') || '');
  const [filterOpener, setFilterOpener] = useState(params.get('opener') || '');
  const [filterTags, setFilterTags] = useState(() => {
    const t = params.get('tags');
    return t ? t.split(',').map(Number).filter(Boolean) : [];
  });

  const syncFiltersToUrl = useCallback((text, assignee, opener, tags) => {
    const p = new URLSearchParams(window.location.search);
    if (text) p.set('q', text); else p.delete('q');
    if (assignee) p.set('assignee', assignee); else p.delete('assignee');
    if (opener) p.set('opener', opener); else p.delete('opener');
    if (tags.length) p.set('tags', tags.join(',')); else p.delete('tags');
    const qs = p.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '');
    window.history.replaceState(null, '', newUrl);
  }, []);

  const isFiltering = filterText || filterAssignee || filterOpener || filterTags.length > 0;

  const matchesFilter = useCallback((card) => {
    if (filterText && !card.title.toLowerCase().includes(filterText.toLowerCase())) return false;
    if (filterAssignee === '_unassigned') {
      if (card.assignee_pubkey) return false;
    } else if (filterAssignee && card.assignee_pubkey !== filterAssignee) {
      return false;
    }
    if (filterOpener && card.author_pubkey !== filterOpener) return false;
    if (filterTags.length > 0) {
      const cardTagIds = (card.tags || []).map(t => t.id);
      if (!filterTags.every(tid => cardTagIds.includes(tid))) return false;
    }
    return true;
  }, [filterText, filterAssignee, filterOpener, filterTags]);

  const truncatePubkey = (pk) => formatPubkey(pk, 20);

  const allCards = useMemo(() => columns.flatMap(c => c.cards || []), [columns]);
  const uniqueAssignees = useMemo(() => [...new Set(allCards.map(c => c.assignee_pubkey).filter(Boolean))], [allCards]);
  const uniqueOpeners = useMemo(() => [...new Set(allCards.map(c => c.author_pubkey).filter(Boolean))], [allCards]);

  const loadBoard = useCallback(async () => {
    try {
      const response = await apiCall('/boards/' + list.id);
      if (response.ok) {
        const data = await response.json();
        setColumns(data.columns);
        setAccess(data.access);
        setBoardTags(data.tags || []);
      } else {
        setError('Failed to load board');
      }
    } catch (err) {
      console.error('Error loading board:', err);
      setError('Failed to load board');
    } finally {
      setLoading(false);
    }
  }, [apiCall, list.id]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const response = await apiCall('/boards/' + list.id + '/activity');
      if (response.ok) {
        setActivity(await response.json());
      }
    } catch (err) {
      console.error('Error loading activity:', err);
    } finally {
      setActivityLoading(false);
    }
  }, [apiCall, list.id]);

  // Load lazily: only once the panel is opened, then refresh on demand.
  useEffect(() => {
    if (showActivity) loadActivity();
  }, [showActivity, loadActivity]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showActivity) setShowActivity(false);
        else if (selectedCard) setSelectedCard(null);
        else if (addingCardColumnId) { setAddingCardColumnId(null); setNewCardTitle(''); }
        else if (editingColumnId) { setEditingColumnId(null); setEditingColumnName(''); }
        else if (addingColumn) { setAddingColumn(false); setNewColumnName(''); }
        else if (showEditBoard) setShowEditBoard(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedCard, addingCardColumnId, addingColumn, editingColumnId, showEditBoard, showActivity]);

  const canWrite = access === 'owner' || access === 'admin' || access === 'write';
  const canAdmin = access === 'owner' || access === 'admin';
  const isOwner = access === 'owner';

  // ── Column operations ────────────────────────────────────────────────

  const handleAddColumn = async (e) => {
    e.preventDefault();
    if (!newColumnName.trim()) return;
    try {
      const response = await apiCall('/boards/' + list.id + '/columns', {
        method: 'POST',
        body: JSON.stringify({ name: newColumnName.trim() }),
      });
      if (response.ok) {
        setNewColumnName('');
        setAddingColumn(false);
        loadBoard();
      }
    } catch (err) {
      console.error('Error creating column:', err);
    }
  };

  const handleDeleteColumn = async (columnId) => {
    const col = columns.find(c => c.id === columnId);
    const cardCount = (col?.cards || []).length;
    const msg = cardCount > 0
      ? `Delete "${col.name}" and its ${cardCount} card${cardCount === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete empty column "${col?.name}"?`;
    if (!window.confirm(msg)) return;
    try {
      await apiCall('/boards/' + list.id + '/columns/' + columnId, { method: 'DELETE' });
      loadBoard();
    } catch (err) {
      console.error('Error deleting column:', err);
    }
  };

  const handleToggleCollapse = async (column) => {
    try {
      await apiCall('/boards/' + list.id + '/columns/' + column.id, {
        method: 'PUT',
        body: JSON.stringify({ collapsed: !column.collapsed }),
      });
      setColumns(prev =>
        prev.map(c => c.id === column.id ? { ...c, collapsed: !c.collapsed } : c)
      );
    } catch (err) {
      console.error('Error toggling collapse:', err);
    }
  };

  const handleRenameColumn = async (columnId) => {
    const trimmed = editingColumnName.trim();
    if (!trimmed) {
      setEditingColumnId(null);
      setEditingColumnName('');
      return;
    }
    // Skip the request if the name didn't actually change.
    const col = columns.find(c => c.id === columnId);
    if (col && col.name === trimmed) {
      setEditingColumnId(null);
      setEditingColumnName('');
      return;
    }
    try {
      const response = await apiCall('/boards/' + list.id + '/columns/' + columnId, {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed }),
      });
      if (response.ok) {
        setColumns(prev =>
          prev.map(c => c.id === columnId ? { ...c, name: trimmed } : c)
        );
      }
    } catch (err) {
      console.error('Error renaming column:', err);
    }
    setEditingColumnId(null);
    setEditingColumnName('');
  };

  const handleReorderColumns = async (newOrder) => {
    setColumns(newOrder);
    try {
      const updatePromises = newOrder.map((col, index) =>
        apiCall('/boards/' + list.id + '/columns/' + col.id, {
          method: 'PUT',
          body: JSON.stringify({ sortOrder: index + 1 }),
        })
      );
      await Promise.all(updatePromises);
    } catch (err) {
      console.error('Error reordering columns:', err);
      loadBoard();
    }
  };

  // ── Card operations ──────────────────────────────────────────────────

  const handleAddCard = async (columnId) => {
    if (!newCardTitle.trim()) return;
    try {
      const response = await apiCall('/boards/' + list.id + '/cards', {
        method: 'POST',
        body: JSON.stringify({ columnId, title: newCardTitle.trim() }),
      });
      if (response.ok) {
        setNewCardTitle('');
        setAddingCardColumnId(null);
        loadBoard();
      }
    } catch (err) {
      console.error('Error creating card:', err);
    }
  };

  const handleMoveCard = async (cardId, targetColumnId) => {
    try {
      const response = await apiCall('/boards/' + list.id + '/cards/' + cardId + '/move', {
        method: 'POST',
        body: JSON.stringify({ columnId: targetColumnId }),
      });
      if (response.ok) {
        loadBoard();
      }
    } catch (err) {
      console.error('Error moving card:', err);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  const ACTIVITY_LABELS = {
    card_created: 'created a card',
    card_moved: 'moved a card',
    card_deleted: 'deleted a card',
    comment_created: 'commented',
  };

  const formatActivityAction = (action) => ACTIVITY_LABELS[action] || action;

  const formatActivityTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMins = Math.floor((now - d) / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return diffHrs + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const getPriorityColor = (p) => {
    if (p <= 1) return 'var(--error)';
    if (p <= 3) return 'var(--warning)';
    if (p <= 5) return '#eab308';
    return 'var(--text-secondary)';
  };

  // Due-date indicator for the card face: overdue = red, due within the
  // next 3 days = amber, further out = subtle gray. Compares whole
  // calendar days (local midnight to local midnight) so "diff" isn't
  // thrown off by the time of day the check happens to run at.
  const formatDate = (d) => {
    if (!d) return null;
    const [y, m, day] = d.slice(0, 10).split('-').map(Number);
    const due = new Date(y, m - 1, day);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((due - today) / (1000 * 60 * 60 * 24));

    if (diff < 0) return { text: 'Overdue', color: 'var(--error)', level: 'overdue' };
    if (diff <= 3) {
      const text = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { text, color: 'var(--warning)', level: 'soon' };
    }
    return { text: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: 'var(--text-secondary)', level: 'later' };
  };

  // ── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal large" onClick={e => e.stopPropagation()}>
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading board...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <h3>Error</h3>
          <p>{error}</p>
          <div className="modal-actions">
            <button onClick={onClose} className="btn btn-primary">Close</button>
          </div>
        </div>
      </div>
    );
  }

  const renderColumn = (column) => (
    <div
      className={'board-column' + (dropTargetColumnId === column.id ? ' board-column-drop-target' : '')}
      onDragOver={canWrite ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetColumnId(column.id); } : undefined}
      onDragLeave={(e) => {
        // Only clear if leaving the column itself, not entering a child.
        if (!e.currentTarget.contains(e.relatedTarget)) setDropTargetColumnId(null);
      }}
      onDrop={canWrite ? (e) => {
        e.preventDefault();
        setDropTargetColumnId(null);
        const cardId = e.dataTransfer.getData('application/x-card-id');
        if (cardId) handleMoveCard(Number(cardId), column.id);
      } : undefined}
    >
      <div
        className="board-column-header"
        style={{ borderTopColor: column.color || 'var(--primary)' }}
      >
        <button
          className="board-collapse-toggle"
          onClick={() => handleToggleCollapse(column)}
          title={column.collapsed ? 'Expand' : 'Collapse'}
        >
          {column.collapsed ? '▸' : '▾'}
        </button>

        {editingColumnId === column.id ? (
          <input
            className="board-column-rename-input"
            type="text"
            value={editingColumnName}
            onChange={e => setEditingColumnName(e.target.value)}
            onBlur={() => handleRenameColumn(column.id)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRenameColumn(column.id);
              if (e.key === 'Escape') { setEditingColumnId(null); setEditingColumnName(''); }
            }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className={'board-column-name' + (canAdmin ? ' editable' : '')}
            onDoubleClick={() => {
              if (!canAdmin) return;
              setEditingColumnId(column.id);
              setEditingColumnName(column.name);
            }}
            title={canAdmin ? 'Double-click to rename' : undefined}
          >
            {column.name}
          </span>
        )}

        <span className="board-column-count">({(column.cards || []).length})</span>
        {canAdmin && (
          <button
            className="board-column-delete"
            onClick={() => handleDeleteColumn(column.id)}
            title="Delete column"
          >
            ×
          </button>
        )}
      </div>

      {!column.collapsed && (
        <div className="board-column-cards">
          {(column.cards || []).filter(matchesFilter).map(card => (
            <div
              key={card.id}
              className="board-card"
              draggable={canWrite}
              onDragStart={canWrite ? (e) => {
                e.dataTransfer.setData('application/x-card-id', String(card.id));
                e.dataTransfer.effectAllowed = 'move';
              } : undefined}
              onContextMenu={(e) => {
                setContextCard({ ...card, _columnId: column.id });
                cardMenu.open(e);
              }}
              onClick={() => setSelectedCard({ ...card, _columnName: column.name })}
            >
              <div className="board-card-title">{card.title}</div>
              <div className="board-card-meta">
                {card.priority && card.priority <= 5 && (
                  <span
                    className="board-card-priority"
                    style={{ color: getPriorityColor(card.priority) }}
                  >
                    P{card.priority}
                  </span>
                )}
                {card.due_date && (() => {
                  const d = formatDate(card.due_date);
                  return d ? (
                    <span
                      className={'board-card-due board-card-due-' + d.level}
                      style={{ color: d.color }}
                      title={'Due ' + d.text}
                    >
                      <span className="board-card-due-dot" style={{ backgroundColor: d.color }} />
                      {d.text}
                    </span>
                  ) : null;
                })()}
                {card.assignee_pubkey && (
                  <span className="board-card-assignee" title={card.assignee_pubkey}>
                    👤
                  </span>
                )}
              </div>
              {card.checklist && (
                <span className="board-card-checklist-badge">
                  {card.checklist.done}/{card.checklist.total}
                </span>
              )}
              {card.tags && card.tags.length > 0 && (
                <div className="board-card-tags">
                  {card.tags.map(tag => (
                    <span
                      key={tag.id}
                      className="board-card-tag-pill"
                      style={{ backgroundColor: tag.color || '#6b7280' }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {canWrite && addingCardColumnId === column.id ? (
            <form
              className="board-add-card-form"
              onSubmit={(e) => { e.preventDefault(); handleAddCard(column.id); }}
            >
              <input
                type="text"
                placeholder="Card title..."
                value={newCardTitle}
                onChange={e => setNewCardTitle(e.target.value)}
                autoFocus
              />
              <div className="board-add-card-actions">
                <button type="submit" className="btn btn-primary btn-small">Add</button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => { setAddingCardColumnId(null); setNewCardTitle(''); }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : canWrite && (
            <button
              className="board-add-card-btn"
              onClick={() => { setAddingCardColumnId(column.id); setNewCardTitle(''); }}
            >
              + Add card
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="board-modal" onClick={e => e.stopPropagation()}>
          <div className="board-header">
            <div className="board-header-left">
              <div
                className="list-icon"
                style={{ backgroundColor: list.color || 'var(--primary)' }}
              >
                {list.icon || boardName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2>{boardName}</h2>
                {boardDescription && <p>{boardDescription}</p>}
              </div>
            </div>
            <div className="board-header-actions">
              {canAdmin && (
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => setShowEditBoard(true)}
                  title="Board settings"
                >
                  ⚙
                </button>
              )}
              {canAdmin && (
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => setAddingColumn(true)}
                >
                  + Column
                </button>
              )}
              <button
                className={'btn btn-secondary btn-small' + (showActivity ? ' active' : '')}
                onClick={() => setShowActivity(v => !v)}
                title="Activity feed"
              >
                🕒 Activity
              </button>
              <button onClick={onClose} className="btn btn-primary btn-small">Close</button>
            </div>
          </div>

          <div className="board-filter-bar">
            <input
              className="board-filter-text"
              type="text"
              placeholder="Search cards..."
              value={filterText}
              onChange={e => {
                setFilterText(e.target.value);
                syncFiltersToUrl(e.target.value, filterAssignee, filterOpener, filterTags);
              }}
            />
            <select
              className="board-filter-assignee"
              value={filterAssignee}
              onChange={e => {
                setFilterAssignee(e.target.value);
                syncFiltersToUrl(filterText, e.target.value, filterOpener, filterTags);
              }}
            >
              <option value="">All assignees</option>
              <option value="_unassigned">Unassigned</option>
              {uniqueAssignees.map(pk => (
                <option key={pk} value={pk}>{truncatePubkey(pk)}</option>
              ))}
            </select>
            <select
              className="board-filter-opener"
              value={filterOpener}
              onChange={e => {
                setFilterOpener(e.target.value);
                syncFiltersToUrl(filterText, filterAssignee, e.target.value, filterTags);
              }}
            >
              <option value="">All openers</option>
              {uniqueOpeners.map(pk => (
                <option key={pk} value={pk}>{truncatePubkey(pk)}</option>
              ))}
            </select>
            {(boardTags || []).length > 0 && (
              <select
                className="board-filter-tag"
                value=""
                onChange={e => {
                  const tid = Number(e.target.value);
                  if (tid && !filterTags.includes(tid)) {
                    const next = [...filterTags, tid];
                    setFilterTags(next);
                    syncFiltersToUrl(filterText, filterAssignee, filterOpener, next);
                  }
                }}
              >
                <option value="">Add tag filter...</option>
                {(boardTags || []).filter(t => !filterTags.includes(t.id)).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            {filterTags.length > 0 && (
              <div className="board-filter-active-tags">
                {filterTags.map(tid => {
                  const tag = (boardTags || []).find(t => t.id === tid);
                  return tag ? (
                    <span key={tid} className="board-card-tag-pill" style={{ backgroundColor: tag.color || '#6b7280' }}>
                      {tag.name}
                      <button
                        className="board-card-tag-remove"
                        onClick={() => {
                          const next = filterTags.filter(id => id !== tid);
                          setFilterTags(next);
                          syncFiltersToUrl(filterText, filterAssignee, filterOpener, next);
                        }}
                      >
                        x
                      </button>
                    </span>
                  ) : null;
                })}
              </div>
            )}
            {isFiltering && (
              <button
                className="btn btn-secondary btn-small board-filter-clear"
                onClick={() => {
                  setFilterText('');
                  setFilterAssignee('');
                  setFilterOpener('');
                  setFilterTags([]);
                  syncFiltersToUrl('', '', '', []);
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div className="board-container">
            {canAdmin && columns.length > 1 ? (
              <DragDropList
                items={columns}
                onReorder={handleReorderColumns}
                itemKey="id"
                isGrid={true}
                className="board-columns-drag"
                renderItem={renderColumn}
              />
            ) : (
              columns.map(column => (
                <React.Fragment key={column.id}>
                  {renderColumn(column)}
                </React.Fragment>
              ))
            )}

            {addingColumn && (
              <div className="board-column board-column-new">
                <form onSubmit={handleAddColumn}>
                  <input
                    type="text"
                    placeholder="Column name..."
                    value={newColumnName}
                    onChange={e => setNewColumnName(e.target.value)}
                    autoFocus
                  />
                  <div className="board-add-card-actions">
                    <button type="submit" className="btn btn-primary btn-small">Add</button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => { setAddingColumn(false); setNewColumnName(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {showActivity && (
            <div className="board-activity-panel">
              <div className="board-activity-panel-header">
                <h4>Activity</h4>
                <button
                  className="board-activity-refresh"
                  onClick={loadActivity}
                  title="Refresh"
                  disabled={activityLoading}
                >
                  ⟳
                </button>
                <button
                  className="board-activity-close"
                  onClick={() => setShowActivity(false)}
                  title="Close"
                >
                  ×
                </button>
              </div>
              <div className="board-activity-list">
                {activityLoading ? (
                  <p className="board-activity-empty">Loading...</p>
                ) : activity.length === 0 ? (
                  <p className="board-activity-empty">No activity yet.</p>
                ) : (
                  activity.map(entry => (
                    <div key={entry.id} className="board-activity-entry">
                      <div className="board-activity-entry-line">
                        <span className="board-activity-actor" title={entry.actor_pubkey}>
                          {truncatePubkey(entry.actor_pubkey)}
                        </span>
                        <span className="board-activity-action">{formatActivityAction(entry.action)}</span>
                      </div>
                      {entry.detail && <div className="board-activity-detail">{entry.detail}</div>}
                      <div className="board-activity-time">{formatActivityTime(entry.created_at)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showEditBoard && ReactDOM.createPortal(
        <EditListModal
          list={{ ...list, name: boardName, description: boardDescription }}
          onClose={() => setShowEditBoard(false)}
          onSave={(updatedList) => {
            setBoardName(updatedList.name);
            setBoardDescription(updatedList.description);
            setShowEditBoard(false);
          }}
          onDelete={() => {
            setShowEditBoard(false);
            onClose();
          }}
          apiCall={apiCall}
          user={user}
        />,
        document.body
      )}

      {cardMenu.isOpen && contextCard && (
        <CardContextMenu
          anchorPoint={cardMenu.anchorPoint}
          onClose={cardMenu.close}
          items={[
            ...columns
              .filter(col => col.id !== contextCard._columnId)
              .map(col => ({
                key: 'move-' + col.id,
                label: 'Move to ' + col.name,
                onClick: () => handleMoveCard(contextCard.id, col.id),
              })),
            ...(columns.filter(col => col.id !== contextCard._columnId).length > 0
              ? [{ key: 'sep-1', separator: true }]
              : []),
            {
              key: 'open',
              label: 'Open card',
              onClick: () => setSelectedCard({ ...contextCard, _columnName: columns.find(c => c.id === contextCard._columnId)?.name }),
            },
            ...(canAdmin ? [
              { key: 'sep-2', separator: true },
              {
                key: 'delete',
                label: 'Delete card',
                danger: true,
                onClick: async () => {
                  if (!window.confirm('Delete this card?')) return;
                  try {
                    await apiCall('/boards/' + list.id + '/cards/' + contextCard.id, { method: 'DELETE' });
                    loadBoard();
                  } catch (err) {
                    console.error('Error deleting card:', err);
                  }
                },
              },
            ] : []),
          ]}
        />
      )}

      {selectedCard && ReactDOM.createPortal(
        <BoardCardModal
          card={selectedCard}
          columns={columns}
          listId={list.id}
          access={access}
          boardTags={boardTags}
          apiCall={apiCall}
          user={user}
          onClose={() => setSelectedCard(null)}
          onCardUpdated={() => {
            setSelectedCard(null);
            loadBoard();
          }}
        />,
        document.body
      )}
    </>
  );
}

export default BoardView;
