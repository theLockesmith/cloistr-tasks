import React, { useState, useEffect, useCallback } from 'react';

function BoardCardModal({ card, columns, listId, access, apiCall, user, onClose, onCardUpdated }) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [priority, setPriority] = useState(card.priority || 3);
  const [dueDate, setDueDate] = useState(card.due_date ? card.due_date.split('T')[0] : '');
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const canWrite = access === 'owner' || access === 'write';
  const isOwner = access === 'owner';

  const loadComments = useCallback(async () => {
    try {
      const response = await apiCall('/boards/' + listId + '/cards/' + card.id + '/comments');
      if (response.ok) {
        setComments(await response.json());
      }
    } catch (err) {
      console.error('Error loading comments:', err);
    }
  }, [apiCall, listId, card.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (editingCommentId) { setEditingCommentId(null); setEditingCommentBody(''); }
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, editingCommentId]);

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const response = await apiCall('/boards/' + listId + '/cards/' + card.id, {
        method: 'PUT',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          dueDate: dueDate || null,
        }),
      });
      if (response.ok) {
        setDirty(false);
        onCardUpdated();
      }
    } catch (err) {
      console.error('Error saving card:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleMove = async (newColumnId) => {
    try {
      const response = await apiCall('/boards/' + listId + '/cards/' + card.id + '/move', {
        method: 'POST',
        body: JSON.stringify({ columnId: Number(newColumnId) }),
      });
      if (response.ok) {
        onCardUpdated();
      }
    } catch (err) {
      console.error('Error moving card:', err);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this card and all its comments?')) return;
    try {
      await apiCall('/boards/' + listId + '/cards/' + card.id, { method: 'DELETE' });
      onCardUpdated();
    } catch (err) {
      console.error('Error deleting card:', err);
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const response = await apiCall('/boards/' + listId + '/cards/' + card.id + '/comments', {
        method: 'POST',
        body: JSON.stringify({ body: newComment.trim() }),
      });
      if (response.ok) {
        setNewComment('');
        loadComments();
      }
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  };

  const handleEditComment = async (commentId) => {
    if (!editingCommentBody.trim()) return;
    try {
      const response = await apiCall('/boards/' + listId + '/comments/' + commentId, {
        method: 'PUT',
        body: JSON.stringify({ body: editingCommentBody.trim() }),
      });
      if (response.ok) {
        setEditingCommentId(null);
        setEditingCommentBody('');
        loadComments();
      }
    } catch (err) {
      console.error('Error editing comment:', err);
    }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await apiCall('/boards/' + listId + '/comments/' + commentId, { method: 'DELETE' });
      loadComments();
    } catch (err) {
      console.error('Error deleting comment:', err);
    }
  };

  const truncatePubkey = (pk) => {
    if (!pk || pk.length < 12) return pk || 'Unknown';
    return pk.slice(0, 6) + '...' + pk.slice(-4);
  };

  const formatTimestamp = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return diffMins + 'm ago';
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return diffHrs + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getPriorityLabel = (p) => {
    if (p <= 1) return { text: 'P1 Critical', color: 'var(--error)' };
    if (p <= 2) return { text: 'P2 High', color: 'var(--warning)' };
    if (p <= 3) return { text: 'P3 Medium', color: '#eab308' };
    if (p <= 5) return { text: 'P' + p + ' Normal', color: 'var(--text-secondary)' };
    return { text: 'P' + p + ' Low', color: 'var(--text-secondary)' };
  };

  const currentColumn = columns.find(c => c.id === card.column_id);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal large board-card-modal" onClick={e => e.stopPropagation()}>
        {/* Title */}
        <div className="board-card-modal-header">
          {canWrite ? (
            <input
              type="text"
              className="board-card-title-input"
              value={title}
              onChange={e => { setTitle(e.target.value); setDirty(true); }}
              placeholder="Card title"
            />
          ) : (
            <h2>{card.title}</h2>
          )}
          <span className="board-card-column-badge">
            {currentColumn ? currentColumn.name : 'Unknown'}
          </span>
        </div>

        {/* Fields */}
        <div className="board-card-fields">
          <div className="board-card-field">
            <label>Description</label>
            {canWrite ? (
              <textarea
                value={description}
                onChange={e => { setDescription(e.target.value); setDirty(true); }}
                placeholder="Add a description..."
                rows={3}
              />
            ) : (
              <p className="board-card-desc-ro">{description || 'No description'}</p>
            )}
          </div>

          <div className="board-card-field-row">
            <div className="board-card-field">
              <label>Priority</label>
              {canWrite ? (
                <select
                  value={priority}
                  onChange={e => { setPriority(Number(e.target.value)); setDirty(true); }}
                >
                  {[1,2,3,4,5,6,7,8,9,10].map(p => {
                    const l = getPriorityLabel(p);
                    return <option key={p} value={p}>{l.text}</option>;
                  })}
                </select>
              ) : (
                <span style={{ color: getPriorityLabel(priority).color }}>
                  {getPriorityLabel(priority).text}
                </span>
              )}
            </div>

            <div className="board-card-field">
              <label>Due Date</label>
              {canWrite ? (
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => { setDueDate(e.target.value); setDirty(true); }}
                />
              ) : (
                <span>{dueDate || 'None'}</span>
              )}
            </div>
          </div>

          {canWrite && (
            <div className="board-card-field">
              <label>Move to Column</label>
              <select
                value={card.column_id}
                onChange={e => handleMove(e.target.value)}
              >
                {columns.map(col => (
                  <option key={col.id} value={col.id}>{col.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Save / Delete actions */}
        {canWrite && (
          <div className="modal-actions">
            {dirty && (
              <button
                className="btn btn-primary btn-small"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
            {isOwner && (
              <button className="btn btn-danger btn-small" onClick={handleDelete}>
                Delete Card
              </button>
            )}
          </div>
        )}

        {/* Comments */}
        <div className="board-comments-section">
          <h3>Comments ({comments.length})</h3>

          <div className="comment-list">
            {comments.length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.9rem' }}>
                No comments yet.
              </p>
            )}
            {comments.map(comment => (
              <div key={comment.id} className="comment-item">
                <div className="comment-header">
                  <span className="comment-author">
                    {comment.author_label || truncatePubkey(comment.author_pubkey)}
                  </span>
                  <span className="comment-time">{formatTimestamp(comment.created_at)}</span>
                </div>

                {editingCommentId === comment.id ? (
                  <div className="comment-edit-form">
                    <textarea
                      value={editingCommentBody}
                      onChange={e => setEditingCommentBody(e.target.value)}
                      rows={2}
                      autoFocus
                    />
                    <div className="board-add-card-actions">
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => handleEditComment(comment.id)}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => { setEditingCommentId(null); setEditingCommentBody(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="comment-body">{comment.body}</p>
                    {comment.author_pubkey === user?.pubkey && (
                      <div className="comment-actions">
                        <button
                          className="comment-action-btn"
                          onClick={() => { setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }}
                        >
                          Edit
                        </button>
                        <button
                          className="comment-action-btn comment-action-delete"
                          onClick={() => handleDeleteComment(comment.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {canWrite && (
            <form className="comment-input-form" onSubmit={handleAddComment}>
              <textarea
                placeholder="Write a comment..."
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                rows={2}
              />
              <button
                type="submit"
                className="btn btn-primary btn-small"
                disabled={!newComment.trim()}
              >
                Comment
              </button>
            </form>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="btn btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}

export default BoardCardModal;
