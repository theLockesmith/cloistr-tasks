import React, { useState, useEffect, useCallback } from 'react';
import BoardCardModal from './BoardCardModal';
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
        else if (addingColumn) { setAddingColumn(false); setNewColumnName(''); }
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, selectedCard, addingCardColumnId, addingColumn]);

  const canWrite = access === 'owner' || access === 'write';
  const isOwner = access === 'owner';

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
    if (!window.confirm('Delete this column and all its cards?')) return;
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="board-modal" onClick={e => e.stopPropagation()}>
        <div className="board-header">
          <div className="board-header-left">
            <div
              className="list-icon"
              style={{ backgroundColor: list.color || 'var(--primary)' }}
            >
              {list.icon || list.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2>{list.name}</h2>
              {list.description && <p>{list.description}</p>}
            </div>
          </div>
          <div className="board-header-actions">
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
          {columns.map(column => (
            <div key={column.id} className="board-column">
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
                <span className="board-column-name">{column.name}</span>
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
          ))}

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
