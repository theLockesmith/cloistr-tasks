import React from 'react';

function TaskItem({ task, onToggle, onEdit }) {
  const formatTime = (timeSlot) => {
    if (!timeSlot) return '';
    if (timeSlot.includes(':')) return timeSlot;
    return timeSlot.charAt(0).toUpperCase() + timeSlot.slice(1);
  };

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
        </div>
        
        {task.template_description && (
          <p className="task-description">{task.template_description}</p>
        )}
        
        {task.estimated_minutes && (
          <span className="task-duration">~{task.estimated_minutes} min</span>
        )}
      </div>
      
      {task.completed_at && (
        <div className="completion-info">
          ✓ {new Date(task.completed_at).toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </div>
      )}
    </div>
  );
}

export default TaskItem;