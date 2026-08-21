import React, { useState, useEffect } from 'react';
import TaskItem from './TaskItem';
import AddTaskModal from './AddTaskModal';
import EditTaskModal from './EditTaskModal';
import EditListModal from './EditListModal';
import DragDropList from './DragDropList';

function TaskListModal({ list, onClose, apiCall, user, onTasksUpdated }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showEditList, setShowEditList] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [filterPriority, setFilterPriority] = useState('all');

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
        
        if (onTasksUpdated) {
          onTasksUpdated();
        }
      }
    } catch (error) {
      console.error('Error toggling task:', error);
    }
  };

  const reorderTasks = async (newTaskOrder) => {
    setTasks(newTaskOrder);
    
    try {
      const updatePromises = newTaskOrder.map((task, index) => 
        apiCall('/templates/' + task.template_id, {
          method: 'PUT',
          body: JSON.stringify({ sort_order: index + 1 })
        })
      );
      
      await Promise.all(updatePromises);
      
      if (onTasksUpdated) {
        onTasksUpdated();
      }
    } catch (error) {
      console.error('Error updating task order:', error);
      loadTasks();
    }
  };

  const getCompletionPercentage = () => {
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(task => task.completed_at).length;
    return Math.round((completed / tasks.length) * 100);
  };

  const getProgressColor = (percentage) => {
    if (percentage === 0) return 'var(--cloistr-error)';
    if (percentage === 100) return 'var(--cloistr-success)';
    if (percentage < 50) return 'color-mix(in srgb, var(--cloistr-warning) ' + (percentage * 2) + '%, var(--cloistr-error))';
    return 'color-mix(in srgb, var(--cloistr-success) ' + ((percentage - 50) * 2) + '%, var(--cloistr-warning))';
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

  // Apply text and priority filters.  Filtering is client-side: we always
  // fetch the full list from the server and narrow it here so the user can
  // clear the filter and get everything back without a round-trip.
  const today = new Date().toISOString().split('T')[0];
  const filteredTasks = tasks.filter(task => {
    if (filterPriority === 'overdue') {
      const dd = task.due_date ? task.due_date.split('T')[0] : null;
      if (!dd || dd >= today) return false;
    } else if (filterPriority !== 'all') {
      if (task.priority !== filterPriority) return false;
    }
    if (filterText) {
      const q = filterText.toLowerCase();
      const nameMatch = (task.template_name || '').toLowerCase().includes(q);
      const descMatch = (task.template_description || '').toLowerCase().includes(q);
      if (!nameMatch && !descMatch) return false;
    }
    return true;
  });
  const isFiltering = filterText !== '' || filterPriority !== 'all';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="list-info">
            <div 
              className="list-icon large"
              style={{
                backgroundColor: list.color || 'var(--primary)'
              }}
            >
              {list.icon || list.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2>{list.name}</h2>
              <p>{list.description}</p>
            </div>
            <button 
              className="btn btn-secondary btn-small"
              onClick={() => setShowEditList(true)}
              title="Edit List"
            >
              ✎
            </button>
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

        <div className="task-filters">
          <input
            type="search"
            className="task-search"
            placeholder="Search tasks..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            aria-label="Search tasks"
          />
          <select
            className="task-filter-priority"
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            aria-label="Filter by priority"
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>

        <div className="tasks-container">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <p>No tasks for today. Add some tasks to get started!</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="empty-state">
              <p>No tasks match your filter.</p>
              <button className="btn btn-secondary btn-small" onClick={() => { setFilterText(''); setFilterPriority('all'); }}>
                Clear filter
              </button>
            </div>
          ) : (
            <DragDropList
              items={filteredTasks}
              onReorder={isFiltering ? () => {} : reorderTasks}
              itemKey="id"
              renderItem={(task) => (
                <TaskItem
                  task={task}
                  onToggle={toggleTask}
                  onEdit={setSelectedTask}
                />
              )}
            />
          )}
        </div>

        <div className="modal-actions">
          <button 
            className="btn btn-secondary"
            onClick={() => setShowAddTask(true)}
          >
            + Add Task
          </button>
          <button onClick={onClose} className="btn btn-primary">Close</button>
        </div>
      </div>

      {showAddTask && (
        <AddTaskModal 
          listId={list.id}
          onClose={() => setShowAddTask(false)}
          onSave={() => {
            loadTasks();
            setShowAddTask(false);
            if (onTasksUpdated) onTasksUpdated();
          }}
          apiCall={apiCall}
        />
      )}

      {selectedTask && (
        <EditTaskModal 
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSave={() => {
            loadTasks();
            setSelectedTask(null);
            if (onTasksUpdated) onTasksUpdated();
          }}
          onDelete={() => {
            loadTasks();
            setSelectedTask(null);
            if (onTasksUpdated) onTasksUpdated();
          }}
          apiCall={apiCall}
        />
      )}

      {showEditList && (
        <EditListModal 
          list={list}
          onClose={() => setShowEditList(false)}
          onSave={(updatedList) => {
            setShowEditList(false);
            if (onTasksUpdated) onTasksUpdated();
          }}
          onDelete={() => {
            setShowEditList(false);
            onClose();
            if (onTasksUpdated) onTasksUpdated();
          }}
          apiCall={apiCall}
        />
      )}
    </div>
  );
}

export default TaskListModal;