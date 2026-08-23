import React, { useState, useEffect } from 'react';
import LabelChip from './LabelChip';

const DEFAULT_COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
];

function LabelManager({ apiCall, onClose }) {
  const [labels, setLabels] = useState([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => { loadLabels(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLabels = async () => {
    try {
      const res = await apiCall('/labels');
      if (res.ok) setLabels(await res.json());
    } catch (e) {
      console.error('Error loading labels:', e);
    } finally {
      setLoading(false);
    }
  };

  const createLabel = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await apiCall('/labels', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      if (res.ok) {
        const label = await res.json();
        setLabels((prev) => [...prev.filter((l) => l.id !== label.id), label].sort((a, b) => a.name.localeCompare(b.name)));
        setNewName('');
        setNewColor('#6366f1');
      } else {
        alert('Failed to create label');
      }
    } catch (e) {
      console.error('Error creating label:', e);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (label) => {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.color);
  };

  const saveEdit = async (id) => {
    setSaving(true);
    try {
      const res = await apiCall('/labels/' + id, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      if (res.ok) {
        const updated = await res.json();
        setLabels((prev) => prev.map((l) => (l.id === id ? updated : l)));
        setEditingId(null);
      } else {
        alert('Failed to save label');
      }
    } catch (e) {
      console.error('Error updating label:', e);
    } finally {
      setSaving(false);
    }
  };

  const removeLabel = async (id) => {
    if (!window.confirm('Delete this label? It will be removed from all tasks.')) return;
    try {
      const res = await apiCall('/labels/' + id, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        setLabels((prev) => prev.filter((l) => l.id !== id));
      }
    } catch (e) {
      console.error('Error deleting label:', e);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Manage Labels</h3>

        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <>
            <div className="label-manager-list">
              {labels.length === 0 && (
                <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  No labels yet. Create one below.
                </p>
              )}
              {labels.map((label) =>
                editingId === label.id ? (
                  <div key={label.id} className="label-manager-row editing">
                    <input
                      className="label-edit-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                    />
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="color-picker-square"
                      style={{ width: 32, height: 32 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      onClick={() => saveEdit(label.id)}
                      disabled={saving}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div key={label.id} className="label-manager-row">
                    <LabelChip label={label} />
                    <div className="label-manager-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => startEdit(label)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => removeLabel(label.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>

            <form onSubmit={createLabel} style={{ marginTop: '1.5rem' }}>
              <h4 style={{ marginBottom: '0.75rem', color: 'var(--text)' }}>New Label</h4>
              <div className="form-row" style={{ alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Label name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ flex: 1 }}
                  required
                />
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="color-picker-square"
                  style={{ width: 40, height: 40, flexShrink: 0 }}
                  title="Label colour"
                />
              </div>
              <div className="color-presets">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={'color-preset' + (newColor === c ? ' selected' : '')}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                    title={c}
                  />
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" onClick={onClose} className="btn btn-secondary">
                  Close
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !newName.trim()}>
                  {saving ? 'Saving...' : 'Add Label'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default LabelManager;
