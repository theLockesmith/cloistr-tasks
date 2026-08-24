import React, { useState, useEffect } from 'react';
import LabelChip from './LabelChip';

const REMINDER_OPTIONS = [
  { value: '', label: 'No reminder' },
  { value: '15',   label: '15 min before' },
  { value: '30',   label: '30 min before' },
  { value: '60',   label: '1 hour before' },
  { value: '120',  label: '2 hours before' },
  { value: '1440', label: '1 day before' },
];

function AddTaskModal({ listId, onClose, onSave, apiCall, parentTemplateId }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    timeSlot: '',
    estimatedMinutes: '',
    priority: 'medium',
    dueDate: '',
    reminderOffsetMinutes: '',
    labelIds: [],
  });
  const [labels, setLabels] = useState([]);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiCall('/labels');
        if (res.ok) setLabels(await res.json());
      } catch (e) {
        console.error('Error loading labels:', e);
      }
    })();
  }, [apiCall]);

  const toggleLabel = (label) => {
    const already = selectedLabels.find((l) => l.id === label.id);
    if (already) {
      setSelectedLabels((prev) => prev.filter((l) => l.id !== label.id));
    } else {
      setSelectedLabels((prev) => [...prev, label]);
    }
  };

  const removeLabel = (label) => {
    setSelectedLabels((prev) => prev.filter((l) => l.id !== label.id));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        ...formData,
        labelIds: selectedLabels.map((l) => l.id),
      };
      if (parentTemplateId) {
        payload.parentTemplateId = parentTemplateId;
      }
      const response = await apiCall('/lists/' + listId + '/templates', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        onSave();
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.error || 'Failed to create task');
      }
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Error creating task');
    } finally {
      setLoading(false);
    }
  };

  const update = (field) => (e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{parentTemplateId ? 'Add Sub-task' : 'Add New Task'}</h3>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Task name"
            value={formData.name}
            onChange={update('name')}
            required
            autoFocus
          />

          <textarea
            placeholder="Description (optional)"
            value={formData.description}
            onChange={update('description')}
          />

          <div className="form-group">
            <label>Priority</label>
            <div className="priority-selector">
              {['low', 'medium', 'high'].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={'priority-option ' + (formData.priority === level ? 'selected ' : '') + 'priority-' + level}
                  onClick={() => setFormData((prev) => ({ ...prev, priority: level }))}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <input
              type="text"
              placeholder="Time (e.g., 8:30, morning)"
              value={formData.timeSlot}
              onChange={update('timeSlot')}
            />
            <input
              type="number"
              placeholder="Minutes"
              min="1"
              value={formData.estimatedMinutes}
              onChange={update('estimatedMinutes')}
            />
          </div>

          <div className="form-group">
            <label>Due Date (optional)</label>
            <input
              type="date"
              value={formData.dueDate}
              onChange={update('dueDate')}
            />
          </div>

          <div className="form-group">
            <label>Reminder</label>
            <select
              value={formData.reminderOffsetMinutes}
              onChange={update('reminderOffsetMinutes')}
              className="task-filter-priority"
              style={{ width: '100%' }}
              disabled={!formData.dueDate && !formData.timeSlot}
            >
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {!formData.dueDate && !formData.timeSlot && (
              <small style={{ color: 'var(--text-secondary)' }}>
                Set a due date or time slot to enable reminders.
              </small>
            )}
          </div>

          {/* Label selector */}
          {labels.length > 0 && (
            <div className="form-group">
              <label>Labels</label>
              <div className="label-chips-row">
                {selectedLabels.map((l) => (
                  <LabelChip key={l.id} label={l} onRemove={removeLabel} />
                ))}
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setShowLabelPicker((v) => !v)}
                >
                  + Label
                </button>
              </div>
              {showLabelPicker && (
                <div className="label-picker-dropdown">
                  {labels.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className={'label-picker-option' + (selectedLabels.find((s) => s.id === l.id) ? ' selected' : '')}
                      onClick={() => toggleLabel(l)}
                    >
                      <LabelChip label={l} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddTaskModal;
