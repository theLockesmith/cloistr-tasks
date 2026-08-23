import React from 'react';
import LabelChip from './LabelChip';

// Priority labels and their CSS class suffix (maps to .priority-badge--{level} in App.css)
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

function TaskItem({ task, onToggle, onEdit }) {
  const formatTime = (timeSlot) => {
    if (!timeSlot) return '';
    if (timeSlot.includes(':')) return timeSlot;
    return timeSlot.charAt(0).toUpperCase() + timeSlot.slice(1);
  };

  // Format a DATE string (YYYY-MM-DD or ISO timestamp) as a short, human-readable
  // label.  We compare against today in local time so "today" and "overdue"
  // are always relative to the viewer's clock.
  const formatDueDate = (rawDate) => {
    if (!rawDate) return null;
    // The DB returns a DATE which pg serialises as a full ISO timestamp at
    // midnight UTC.  Strip the time part so the comparison is date-only.
    const dateStr = rawDate.split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    if (dateStr === today) return { label: 'Due today', overdue: false, soon: true };
    if (dateStr < today) return { label: 'Overdue', overdue: true, soon: false };
    // Within the next 3 days counts as "soon"
    const daysAhead = (new Date(dateStr) - new Date(today)) / 86400000;
    const label = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { label, overdue: false, soon: daysAhead <= 3 };
  };

  const dueInfo = formatDueDate(task.due_date);
  const showPriority = task.priority && task.priority !== 'medium';
  const taskLabels = Array.isArray(task.labels) ? task.labels : [];
  const subtaskCount = Number(task.subtask_count) || 0;
  const hasReminder = task.reminder_offset_minutes != null && (task.due_date || task.time_slot);

  return (
    <div
      className={'task-item' + (task.completed_at ? ' completed' : '')}
      style={{ cursor: onEdit ? 'pointer' : 'default' }}
    >
      <input
        type="checkbox"
        checked={!!task.completed_at}
        onChange={(e) => {
          e.stopPropagation();
          onToggle(task.id);
        }}
        className="task-checkbox"
        onClick={(e) => e.stopPropagation()}
      />

      <div
        className="task-content"
        onClick={() => onEdit && onEdit(task)}
      >
        <div className="task-main">
          <h4>{task.template_name}</h4>
          {task.time_slot && (
            <span className="task-time">{formatTime(task.time_slot)}</span>
          )}
          {subtaskCount > 0 && (
            <span className="subtask-count-badge" title={subtaskCount + ' sub-task' + (subtaskCount !== 1 ? 's' : '')}>
              {subtaskCount} sub
            </span>
          )}
          {hasReminder && (
            <span className="reminder-badge" title={'Reminder: ' + task.reminder_offset_minutes + ' min before'}>
              🔔
            </span>
          )}
        </div>

        {task.template_description && (
          <p className="task-description">{task.template_description}</p>
        )}

        <div className="task-meta">
          {task.estimated_minutes && (
            <span className="task-duration">~{task.estimated_minutes} min</span>
          )}

          {showPriority && (
            <span className={'priority-badge ' + task.priority}>
              {PRIORITY_LABELS[task.priority] || task.priority}
            </span>
          )}

          {dueInfo && (
            <span className={
              'due-date-badge' +
              (dueInfo.overdue ? ' overdue' : '') +
              (dueInfo.soon && !dueInfo.overdue ? ' soon' : '')
            }>
              {dueInfo.label}
            </span>
          )}

          {taskLabels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      </div>

      {task.completed_at && (
        <div className="completion-info">
          ✓ {new Date(task.completed_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      )}
    </div>
  );
}

export default TaskItem;
