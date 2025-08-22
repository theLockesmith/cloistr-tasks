// App.js - Main React Component with Keycloak Authentication
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import UserSettings from './UserSettings';
import './App.css';

// Login component
function LoginScreen() {
  const { login, keycloakConfig, loading } = useAuth();

  if (loading || !keycloakConfig) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="login-container">
        <div className="login-card">
          <h1>📋 Daily Task Manager</h1>
          <p>Organize your daily routines and track your progress</p>
          
          <button onClick={login} className="btn btn-primary login-btn">
            🔐 Sign In with Keycloak
          </button>
          
          <div className="login-features">
            <h3>Features:</h3>
            <ul>
              <li>✅ Personal task lists and routines</li>
              <li>🔄 Customizable reset schedules</li>
              <li>📊 Progress tracking and analytics</li>
              <li>⏰ Flexible time-based scheduling</li>
              <li>🔒 Secure user authentication</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// Main authenticated app
function AuthenticatedApp() {
  const { user, logout, apiCall } = useAuth();
  const [lists, setLists] = useState([]);
  const [selectedList, setSelectedList] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddList, setShowAddList] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadLists();
  }, []);

  const loadLists = async () => {
    try {
      const response = await apiCall('/lists');
      if (response.ok) {
        const data = await response.json();
        setLists(data);
      }
    } catch (error) {
      console.error('Error loading lists:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async (listId) => {
    try {
      const response = await apiCall(`/lists/${listId}/tasks`);
      if (response.ok) {
        const data = await response.json();
        setTasks(data);
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  };

  const toggleTask = async (taskId) => {
    try {
      const response = await apiCall(`/tasks/${taskId}/toggle`, {
        method: 'POST',
      });
      
      if (response.ok) {
        const updatedTask = await response.json();
        setTasks(tasks.map(task => 
          task.id === taskId ? { ...task, completed_at: updatedTask.completed_at } : task
        ));
        // Refresh lists to update completion counts
        loadLists();
      }
    } catch (error) {
      console.error('Error toggling task:', error);
    }
  };

  const selectList = (list) => {
    setSelectedList(list);
    loadTasks(list.id);
  };

  const getCompletionPercentage = (list) => {
    const total = Number(list.total_tasks) || 0;
    const completed = Number(list.completed_tasks) || 0;
    
    console.log('Debug percentage calc:', { total, completed, list }); // Temporary debug line
    
    if (total === 0) return 0;
    
    const percentage = Math.round((completed / total) * 100);
    return isNaN(percentage) ? 0 : percentage;
  };

  const formatTime = (timeSlot) => {
    if (!timeSlot) return '';
    if (timeSlot.includes(':')) return timeSlot;
    return timeSlot.charAt(0).toUpperCase() + timeSlot.slice(1);
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
            <h1>📋 Daily Task Manager</h1>
            <p className="date">{getCurrentDate()}</p>
          </div>
          
          <div className="header-right">
            <div className="user-info">
              <span>Welcome, {user?.firstName || user?.username}!</span>
              <button 
                className="btn btn-secondary btn-small"
                onClick={() => setShowSettings(true)}
              >
                ⚙️ Settings
              </button>
              <button 
                className="btn btn-secondary btn-small"
                onClick={logout}
              >
                🚪 Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="main-content">
        {!selectedList ? (
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
                  📝 Create Your First List
                </button>
              </div>
            ) : (
              <div className="lists-grid">
                {lists.map(list => (
                  <div 
                    key={list.id} 
                    className="list-card"
                    onClick={() => selectList(list)}
                  >
                    <div className="list-header">
                      <span className="list-icon">{list.icon}</span>
                      <h3>{list.name}</h3>
                    </div>
                    
                    <div className="list-stats">
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{ 
                            width: `${getCompletionPercentage(list)}%`,
                            backgroundColor: list.color 
                          }}
                        ></div>
                      </div>
                      <p className="progress-text">
                      {list.completed_tasks || 0}/{list.total_tasks || 0} completed ({getCompletionPercentage(list)}%)
                      </p>
                    </div>
                    
                    <p className="list-description">{list.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="task-view">
            <div className="task-header">
              <button 
                className="btn btn-secondary"
                onClick={() => setSelectedList(null)}
              >
                ← Back to Lists
              </button>
              
              <div className="list-info">
                <span className="list-icon large">{selectedList.icon}</span>
                <div>
                  <h2>{selectedList.name}</h2>
                  <p>{selectedList.description}</p>
                </div>
              </div>
              
              <button 
                className="btn btn-primary"
                onClick={() => setShowAddTask(true)}
              >
                + Add Task
              </button>
            </div>

            <div className="tasks-container">
              {tasks.length === 0 ? (
                <div className="empty-state">
                  <p>No tasks for today. Add some tasks to get started!</p>
                </div>
              ) : (
                <div className="tasks-list">
                  {tasks.map(task => (
                    <div 
                      key={task.id} 
                      className={`task-item ${task.completed_at ? 'completed' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!task.completed_at}
                        onChange={() => toggleTask(task.id)}
                        className="task-checkbox"
                      />
                      
                      <div className="task-content">
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
                          ✅ {new Date(task.completed_at).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add List Modal */}
      {showAddList && (
        <AddListModal 
          onClose={() => setShowAddList(false)}
          onSave={(newList) => {
            setLists([...lists, newList]);
            setShowAddList(false);
          }}
          apiCall={apiCall}
        />
      )}

      {/* Add Task Modal */}
      {showAddTask && selectedList && (
        <AddTaskModal 
          listId={selectedList.id}
          onClose={() => setShowAddTask(false)}
          onSave={() => {
            loadTasks(selectedList.id);
            setShowAddTask(false);
          }}
          apiCall={apiCall}
        />
      )}

      {/* User Settings Modal */}
      {showSettings && (
        <UserSettings 
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// Add List Modal Component
function AddListModal({ onClose, onSave, apiCall }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    icon: '📋',
    color: '#3b82f6'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const response = await apiCall('/lists', {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        const newList = await response.json();
        onSave(newList);
      } else {
        alert('Failed to create list');
      }
    } catch (error) {
      console.error('Error creating list:', error);
      alert('Error creating list');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Create New List</h3>
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="List name"
            value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})}
            required
          />
          
          <textarea
            placeholder="Description"
            value={formData.description}
            onChange={e => setFormData({...formData, description: e.target.value})}
          />
          
          <div className="form-row">
            <input
              type="text"
              placeholder="Icon (emoji)"
              value={formData.icon}
              onChange={e => setFormData({...formData, icon: e.target.value})}
              maxLength={2}
            />
            
            <input
              type="color"
              value={formData.color}
              onChange={e => setFormData({...formData, color: e.target.value})}
            />
          </div>
          
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create List'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Add Task Modal Component  
function AddTaskModal({ listId, onClose, onSave, apiCall }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    timeSlot: '',
    estimatedMinutes: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const response = await apiCall(`/lists/${listId}/templates`, {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        onSave();
      } else {
        alert('Failed to create task');
      }
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Error creating task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Add New Task</h3>
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Task name"
            value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})}
            required
          />
          
          <textarea
            placeholder="Description"
            value={formData.description}
            onChange={e => setFormData({...formData, description: e.target.value})}
          />
          
          <div className="form-row">
            <input
              type="text"
              placeholder="Time (e.g., 8:30, morning)"
              value={formData.timeSlot}
              onChange={e => setFormData({...formData, timeSlot: e.target.value})}
            />
            
            <input
              type="number"
              placeholder="Minutes"
              value={formData.estimatedMinutes}
              onChange={e => setFormData({...formData, estimatedMinutes: e.target.value})}
            />
          </div>
          
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

// Main App component with AuthProvider
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

// App content that uses auth context
function AppContent() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return isAuthenticated() ? <AuthenticatedApp /> : <LoginScreen />;
}

export default App;