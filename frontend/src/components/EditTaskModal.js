import React, { useState, useEffect } from 'react';
import LabelChip from './LabelChip';
import AddTaskModal from './AddTaskModal';

const REMINDER_OPTIONS = [
  { value: '', label: 'No reminder' },
  { value: '15',   label: '15 min before' },
  { value: '30',   label: '30 min before' },
  { value: '60',   label: '1 hour before' },
  { value: '120',  label: '2 hours before' },
  { value: '1440', label: '1 day before' },
];

function EditTaskModal({ task, onClose, onSave, onDelete, apiCall }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    timeSlot: '',
    estimatedMinutes: '',
    priority: 'medium',
    dueDate: '',
    reminderOffsetMinutes: '',
  });
  const [labels, setLabels] = useState([]);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [subtasks, setSubtasks] = useState([]);
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape' && !showAddSubtask) onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showAddSubtask]);

  useEffect(() => {
    if (task) {
      setFormData({
        name: task.template_name || '',
        description: task.template_description || '',
        timeSlot: task.time_slot || '',
        estimatedMinutes: task.estimated_minutes || '',
        priority: task.priority || 'medium',
        dueDate: task.due_date ? task.due_date.split('T')[0] : '',
        reminderOffsetMinutes: task.reminder_offset_minutes != null ? String(task.reminder_offset_minutes) : '',
      });
      // Seed labels from task data (labels come back as array from the API)
      const taskLabels = Array.isArray(task.labels) ? task.labels : [];
      setSelectedLabels(taskLabels);

      // Load all user labels for the picker
      (async () => {
        try {
          const res = await apiCall('/labels');
          if (res.ok) setLabels(await res.json());
        } catch (e) {
          console.error('Error loading labels:', e);
        }
      })();

      // Load sub-tasks if this is a top-level task
      if (!task.parent_template_id) {
        loadSubtasks();
      }
    }
  }, [task]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSubtasks = async () => {
    try {
      const res = await apiCall('/templates/' + task.template_id + '/subtasks');
      if (res.ok) setSubtasks(await res.json());
    } catch (e) {
      console.error('Error loading subtasks:', e);
    }
  };

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

  const toggleSubtask = async (subtask) => {
    try {
      if (subtask.task_id) {
        const res = await apiCall('/tasks/' + subtask.task_id + '/toggle', { method: 'POST' });
        if (res.ok) {
          const updated = await res.json();
          setSubtasks((prev) =>
            prev.map((s) => (s.id === subtask.id ? { ...s, completed_at: updated.completed_at } : s))
          );
        }
      } else {
        // No task instance exists for today yet — create one first (the
        // template create path already provisions today's instance, but
        // subtasks added via the subtask endpoint may need manual insertion).
        const res = await apiCall('/tasks', {
          method: 'POST',
          body: JSON.stringify({ templateId: subtask.id }),
        });
        if (res.ok) loadSubtasks();
      }
    } catch (e) {
      console.error('Error toggling subtask:', e);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await apiCall('/templates/' + task.template_id, {
        method: 'PUT',
        body: JSON.stringify({
          ...formData,
          reminderOffsetMinutes: formData.reminderOffsetMinutes || null,
          labelIds: selectedLabels.map((l) => l.id),
        }),
      });

      if (response.ok) {
        onSave();
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.error || 'Failed to update task');
      }
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Error updating task');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this task template? It will be removed from all future days.')) return;
    setDeleting(true);
    try {
      const response = await apiCall('/templates/' + task.template_id, { method: 'DELETE' });
      if (response.ok) {
        onDelete();
      } else {
        alert('Failed to delete task');
      }
    } catch (error) {
      console.error('Error deleting task:', error);
      alert('Error deleting task');
    } finally {
      setDeleting(false);
    }
  };

  const update = (field) => (e) => setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Task</h3>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Task name"
            value={formData.name}
            onChange={update('name')}
            required
          />

          <textarea
            placeholder="Description"
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

          {/* Label selector — only shown for users who have labels */}
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
                  {showLabelPicker ? 'Done' : '+ Label'}
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

          {/* Sub-tasks section — only for top-level tasks */}
          {!task.parent_template_id && (
            <div className="form-group subtasks-section">
              <label>Sub-tasks</label>
              {subtasks.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontStyle: 'italic' }}>
                  No sub-tasks yet.
                </p>
              ) : (
                <div className="subtask-list">
                  {subtasks.map((s) => (
                    <div key={s.id} className="subtask-row">
                      <input
                        type="checkbox"
                        checked={!!s.completed_at}
                        onChange={() => toggleSubtask(s)}
                        className="task-checkbox"
                      />
                      <span style={{
                        textDecoration: s.completed_at ? 'line-through' : 'none',
                        opacity: s.completed_at ? 0.6 : 1,
                        flex: 1,
                      }}>
                        {s.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-small"
                style={{ marginTop: '0.5rem' }}
                onClick={() => setShowAddSubtask(true)}
              >
                + Add Sub-task
              </button>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              onClick={handleDelete}
              className="btn btn-danger"
              disabled={loading || deleting}
            >
              {deleting ? 'Deleting...' : 'Delete Task'}
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading || deleting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || deleting}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {showAddSubtask && (
        <AddTaskModal
          listId={task.list_id}
          parentTemplateId={task.template_id}
          onClose={() => setShowAddSubtask(false)}
          onSave={() => {
            setShowAddSubtask(false);
            loadSubtasks();
          }}
          apiCall={apiCall}
        />
      )}
    </div>
  );
}

export default EditTaskModal;
