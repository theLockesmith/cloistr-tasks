import React, { useState, useEffect } from 'react';
import TaskItem from './TaskItem';

function TaskListModal({ list, onClose, apiCall, user, onTasksUpdated }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (list) {
      loadTasks();
    }
  }, [list]);

  const loadTasks = async () => {
    if (!list) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await apiCall('/lists/' + list.id + '/tasks');
      if (response.ok) {
        const data = await response.json();
        setTasks(data);
      } else {
        setError('Failed to load tasks');
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const toggleTask = async (taskId) => {
    try {
      const response = await apiCall('/tasks/' + taskId + '/toggle', {
        method: 'POST',
      });
      
      if (response.ok) {
        const updatedTask = await response.json();
        setTasks(tasks.map(task => 
          task.id === taskId ? { ...task, completed_at: updatedTask.completed_at } : task
        ));
        
        // Notify parent to refresh data
        if (onTasksUpdated) {
          onTasksUpdated();
        }
      }
    } catch (error) {
      console.error('Error toggling task:', error);
    }
  };

  const getCompletionPercentage = () => {
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(task => task.completed_at).length;
    return Math.round((completed / tasks.length) * 100);
  };

  const getProgressColor = (percentage) => {
    if (percentage === 0) return '#ef4444';
    if (percentage === 100) return '#22c55e';
    
    const red = Math.round(239 - (239 - 34) * (percentage / 100));
    const green = Math.round(68 + (197 - 68) * (percentage / 100));
    const blue = Math.round(68 + (94 - 68) * (percentage / 100));
    
    return 'rgb(' + red + ',' + green + ',' + blue + ')';
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal large" onClick={e => e.stopPropagation()}>
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading tasks...</p>
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

  const completionPercentage = getCompletionPercentage();
  const completedTasks = tasks.filter(task => task.completed_at);
  const incompleteTasks = tasks.filter(task => !task.completed_at);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="list-info">
            <div className="list-icon large">
              {list.icon || list.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2>{list.name}</h2>
              <p>{list.description}</p>
            </div>
          </div>
          
          <div className="list-stats">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ 
                  width: completionPercentage + '%',
                  backgroundColor: getProgressColor(completionPercentage)
                }}
              ></div>
            </div>
            <p className="progress-text">
              {completedTasks.length}/{tasks.length} completed ({completionPercentage}%)
            </p>
          </div>
        </div>

        <div className="tasks-container">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <p>No tasks for today. Add some tasks to get started!</p>
            </div>
          ) : (
            <div className="tasks-list">
              {incompleteTasks.map(task => (
                <TaskItem key={task.id} task={task} onToggle={toggleTask} />
              ))}
              
              {completedTasks.map(task => (
                <TaskItem key={task.id} task={task} onToggle={toggleTask} />
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="btn btn-primary">Close</button>
        </div>
      </div>
    </div>
  );
}

export default TaskListModal;