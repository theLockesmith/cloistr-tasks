import React, { useState, useEffect, useCallback } from 'react';
import BoardCardModal from './BoardCardModal';
import DragDropList from './DragDropList';
import EditListModal from './EditListModal';
import { isListOwner, canWriteList } from '../lib/accessHelpers';

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

  const loadBoard = useCallback(async () => {
    try {
      const response = await apiCall('/boards/' + list.id);
      if (response.ok) {
        const data = await response.json();
        setColumns(data.columns);
        setAccess(data.access);
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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (selectedCard) setSelectedCard(null);
        else if (addingCardColumnId) { setAddingCardColumnId(null); setNewCardTitle(''); }
        else if (editingColumnId) { setEditingColumnId(null); setEditingColumnName(''); }
        else if (addingColumn) { setAddingColumn(false); setNewColumnName(''); }
        else if (showEditBoard) setShowEditBoard(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedCard, addingCardColumnId, addingColumn, editingColumnId, showEditBoard]);

  const canWrite = access === 'owner' || access === 'write';
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

  // ── Helpers ──────────────────────────────────────────────────────────

  const getPriorityColor = (p) => {
    if (p <= 1) return 'var(--error)';
    if (p <= 3) return 'var(--warning)';
    if (p <= 5) return '#eab308';
    return 'var(--text-secondary)';
  };

  const formatDate = (d) => {
    if (!d) return null;
    const date = new Date(d);
    const today = new Date();
    const diff = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { text: 'Overdue', color: 'var(--error)' };
    if (diff === 0) return { text: 'Today', color: 'var(--warning)' };
    if (diff === 1) return { text: 'Tomorrow', color: 'var(--warning)' };
    return { text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), color: 'var(--text-secondary)' };
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
    <div className="board-column">
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
            className={'board-column-name' + (isOwner ? ' editable' : '')}
            onDoubleClick={() => {
              if (!isOwner) return;
              setEditingColumnId(column.id);
              setEditingColumnName(column.name);
            }}
            title={isOwner ? 'Double-click to rename' : undefined}
          >
            {column.name}
          </span>
        )}

        <span className="board-column-count">{(column.cards || []).length}</span>
        {isOwner && (
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
          {(column.cards || []).map(card => (
            <div
              key={card.id}
              className="board-card"
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
                  return d ? <span style={{ color: d.color, fontSize: '0.75rem' }}>{d.text}</span> : null;
                })()}
                {card.assignee_pubkey && (
                  <span className="board-card-assignee" title={card.assignee_pubkey}>
                    👤
                  </span>
                )}
              </div>
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
            {isOwner && (
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setShowEditBoard(true)}
                title="Board settings"
              >
                ⚙
              </button>
            )}
            {isOwner && (
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setAddingColumn(true)}
              >
                + Column
              </button>
            )}
            <button onClick={onClose} className="btn btn-primary btn-small">Close</button>
          </div>
        </div>

        <div className="board-container">
          {isOwner && columns.length > 1 ? (
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
      </div>

      {showEditBoard && (
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
        />
      )}

      {selectedCard && (
        <BoardCardModal
          card={selectedCard}
          columns={columns}
          listId={list.id}
          access={access}
          apiCall={apiCall}
          user={user}
          onClose={() => setSelectedCard(null)}
          onCardUpdated={() => {
            setSelectedCard(null);
            loadBoard();
          }}
        />
      )}
    </div>
  );
}

export default BoardView;
