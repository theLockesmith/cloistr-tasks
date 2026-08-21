import React from 'react';
import LabelChip from './LabelChip';
import { formatDueDate, normaliseLabels, parseSubtaskCount } from '../lib/taskHelpers';

// Priority labels and their CSS class suffix (maps to .priority-badge--{level} in App.css)
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

function TaskItem({ task, onToggle, onEdit }) {
  const formatTime = (timeSlot) => {
    if (!timeSlot) return '';
    if (timeSlot.includes(':')) return timeSlot;
    return timeSlot.charAt(0).toUpperCase() + timeSlot.slice(1);
  };

  const dueInfo = formatDueDate(task.due_date);
  const showPriority = task.priority && task.priority !== 'medium';
  const taskLabels = normaliseLabels(task.labels);
  const subtaskCount = parseSubtaskCount(task.subtask_count);
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
