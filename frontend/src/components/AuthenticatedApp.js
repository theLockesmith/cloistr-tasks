import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import TaskListModal from './TaskListModal';
import UserSettings from './UserSettings';
import AddListModal from './AddListModal';
import AddTaskModal from './AddTaskModal';
import DragDropList from './DragDropList';

function AuthenticatedApp() {
  const { user, logout, apiCall, formatPubkey } = useAuth();
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddList, setShowAddList] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [userSettings, setUserSettings] = useState({
    previewTaskCount: 5,
    showCompletedInPreview: false,
    theme: 'system',
    resetEnabled: true,
    resetTime: '06:00',
    resetDays: 'daily',
    customResetDays: []
  });

  const [taskPreviews, setTaskPreviews] = useState({});

  useEffect(() => {
    loadLists();
    loadUserSettings();
  }, []);

  useEffect(() => {
    const theme = userSettings.theme === 'system' 
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : userSettings.theme;
    document.documentElement.setAttribute('data-theme', theme);
  }, [userSettings.theme]);

  useEffect(() => {
    if (userSettings.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        document.documentElement.setAttribute('data-theme', 
          mediaQuery.matches ? 'dark' : 'light'
        );
      };
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [userSettings.theme]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false);
        else if (showAddList) setShowAddList(false);
        else if (showAddTask) setShowAddTask(false);
        else if (selectedList) setSelectedList(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSettings, showAddList, showAddTask, selectedList]);

  const loadLists = async () => {
    try {
      const response = await apiCall('/lists');
      if (response.ok) {
        const data = await response.json();
        setLists(data);
        data.forEach(list => loadTaskPreview(list.id));
      }
    } catch (error) {
      console.error('Error loading lists:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserSettings = async () => {
    try {
      const response = await apiCall('/user/profile');
      if (response.ok) {
        const data = await response.json();
        setUserSettings(prev => ({
          ...prev,
          previewTaskCount: data.preview_task_count || 5,
          showCompletedInPreview: data.show_completed_in_preview || false,
          theme: data.theme || 'system',
          resetEnabled: data.reset_enabled !== false,
          resetTime: data.reset_time || '06:00',
          resetDays: data.reset_days || 'daily',
          customResetDays: data.custom_reset_days || []
        }));
      }
    } catch (error) {
      console.error('Error loading user settings:', error);
    }
  };

  const loadTaskPreview = async (listId) => {
    try {
      const response = await apiCall('/lists/' + listId + '/tasks');
      if (response.ok) {
        const tasks = await response.json();
        setTaskPreviews(prev => ({
          ...prev,
          [listId]: tasks
        }));
      }
    } catch (error) {
      console.error('Error loading task preview:', error);
    }
  };

  const toggleTaskFromPreview = async (taskId, listId) => {
    try {
      const response = await apiCall('/tasks/' + taskId + '/toggle', {
        method: 'POST',
      });
      
      if (response.ok) {
        loadTaskPreview(listId);
        loadLists();
      }
    } catch (error) {
      console.error('Error toggling task from preview:', error);
    }
  };

  const reorderLists = async (newListOrder) => {
    setLists(newListOrder);
    
    try {
      const updatePromises = newListOrder.map((list, index) => 
        apiCall('/lists/' + list.id, {
          method: 'PUT',
          body: JSON.stringify({ sort_order: index + 1 })
        })
      );
      
      await Promise.all(updatePromises);
    } catch (error) {
      console.error('Error updating list order:', error);
      loadLists();
    }
  };

  const getCompletionPercentage = (list) => {
    const total = Number(list.total_tasks) || 0;
    const completed = Number(list.completed_tasks) || 0;
    
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  };

  const getProgressColor = (percentage) => {
    if (percentage === 0) return '#ef4444';
    if (percentage === 100) return '#22c55e';
    
    const red = Math.round(239 - (239 - 34) * (percentage / 100));
    const green = Math.round(68 + (197 - 68) * (percentage / 100));
    const blue = Math.round(68 + (94 - 68) * (percentage / 100));
    
    return 'rgb(' + red + ',' + green + ',' + blue + ')';
  };

  const getTaskPreviewForList = (listId) => {
    const tasks = taskPreviews[listId] || [];
    const incompleteTasks = tasks.filter(task => !task.completed_at);
    const completedTasks = tasks.filter(task => task.completed_at);
    
    let previewTasks;
    if (userSettings.showCompletedInPreview) {
      previewTasks = [...incompleteTasks, ...completedTasks].slice(0, userSettings.previewTaskCount);
    } else {
      previewTasks = incompleteTasks.slice(0, userSettings.previewTaskCount);
    }
    
    return previewTasks;
  };

  const getCurrentDate = () => {
    return new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading your routines...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-left">
            <h1>Daily Task Manager</h1>
            <p className="date">{getCurrentDate()}</p>
          </div>
          
          <div className="header-right">
            <div className="user-info">
              <span>Welcome, {user?.firstName || user?.username || (user?.pubkey && formatPubkey(user.pubkey))}!</span>
              <button 
                className="btn btn-secondary btn-small"
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                ⚙
              </button>
              <button 
                className="btn btn-secondary btn-small"
                onClick={logout}
                title="Logout"
              >
                ↗
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="dashboard">
          <div className="dashboard-header">
            <h2>Your Task Lists</h2>
            <button 
              className="btn btn-primary"
              onClick={() => setShowAddList(true)}
            >
              + Add List
            </button>
          </div>
          
          {lists.length === 0 ? (
            <div className="empty-state">
              <h3>No task lists yet!</h3>
              <p>Create your first task list to get started with organizing your daily routines.</p>
              <button 
                className="btn btn-primary"
                onClick={() => setShowAddList(true)}
              >
                Create Your First List
              </button>
            </div>
          ) : (
            <DragDropList
              items={lists}
              onReorder={reorderLists}
              itemKey="id"
              isGrid={true}
              className="lists-grid"
              renderItem={(list) => {
                const percentage = getCompletionPercentage(list);
                const previewTasks = getTaskPreviewForList(list.id);
                const totalTasks = taskPreviews[list.id]?.length || 0;
                
                return (
                  <div 
                    className="list-card"
                    onClick={() => setSelectedList(list)}
                  >
                    <div className="list-header">
                      <div 
                        className="list-icon"
                        style={{
                          backgroundColor: list.color || 'var(--primary)'
                        }}
                      >
                        {list.icon || list.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3>{list.name}</h3>
                        <p className="list-description">{list.description}</p>
                      </div>
                    </div>
                    
                    <div className="list-stats">
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{ 
                            width: percentage + '%',
                            backgroundColor: getProgressColor(percentage)
                          }}
                        ></div>
                      </div>
                      <p className="progress-text">
                        {list.completed_tasks || 0}/{list.total_tasks || 0} completed ({percentage}%)
                      </p>
                    </div>

                    <div className="task-preview">
                      <h4 style={{ 
                        fontSize: '1rem', 
                        fontWeight: '600', 
                        marginBottom: '0.75rem',
                        color: 'var(--text)'
                      }}>
                        {userSettings.showCompletedInPreview ? 'Tasks:' : 'Upcoming Tasks:'}
                      </h4>
                      
                      {previewTasks.length === 0 ? (
                        <p style={{ 
                          color: 'var(--text-secondary)', 
                          fontStyle: 'italic',
                          fontSize: '0.9rem'
                        }}>
                          {userSettings.showCompletedInPreview 
                            ? 'No tasks' 
                            : (totalTasks > 0 ? 'All tasks completed!' : 'No tasks')
                          }
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {previewTasks.map(task => (
                            <div 
                              key={task.id}
                              className="task-preview-item"
                              style={{
                                opacity: task.completed_at ? 0.6 : 1,
                                textDecoration: task.completed_at ? 'line-through' : 'none',
                                cursor: 'pointer'
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTaskFromPreview(task.id, list.id);
                              }}
                            >
                              <div 
                                className="task-preview-checkbox"
                                style={{
                                  backgroundColor: task.completed_at 
                                    ? 'var(--primary)' 
                                    : 'var(--border)',
                                  color: task.completed_at ? 'white' : 'var(--text-secondary)',
                                  cursor: 'pointer'
                                }}
                              >
                                {task.completed_at ? '✓' : ''}
                              </div>
                              <span className="task-preview-name">{task.template_name}</span>
                              {task.time_slot && (
                                <span className="task-preview-time">
                                  • {task.time_slot}
                                </span>
                              )}
                            </div>
                          ))}
                          {totalTasks > userSettings.previewTaskCount && (
                            <p style={{ 
                              color: 'var(--text-secondary)',
                              fontSize: '0.8rem',
                              fontStyle: 'italic',
                              marginTop: '0.25rem'
                            }}>
                              +{totalTasks - userSettings.previewTaskCount} more tasks...
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          )}
        </div>
      </div>

      {showAddList && (
        <AddListModal 
          onClose={() => setShowAddList(false)}
          onSave={(newList) => {
            setLists([...lists, newList]);
            setShowAddList(false);
            loadTaskPreview(newList.id);
          }}
          apiCall={apiCall}
        />
      )}

      {showAddTask && selectedList && (
        <AddTaskModal 
          listId={selectedList.id}
          onClose={() => setShowAddTask(false)}
          onSave={() => {
            loadTaskPreview(selectedList.id);
            loadLists();
            setShowAddTask(false);
          }}
          apiCall={apiCall}
        />
      )}

      {selectedList && (
        <TaskListModal
          list={selectedList}
          onClose={() => setSelectedList(null)}
          apiCall={apiCall}
          user={user}
          onTasksUpdated={() => {
            loadLists();
            loadTaskPreview(selectedList.id);
          }}
        />
      )}

      {showSettings && (
        <UserSettings 
          onClose={() => setShowSettings(false)}
          apiCall={apiCall}
          userSettings={userSettings}
          setUserSettings={setUserSettings}
          onSettingsUpdate={() => {
            loadLists();
          }}
        />
      )}
    </div>
  );
}

export default AuthenticatedApp;