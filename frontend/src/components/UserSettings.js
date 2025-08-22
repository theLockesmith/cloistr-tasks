import React, { useState, useEffect } from 'react';

function UserSettings({ onClose, apiCall, userSettings, setUserSettings, onSettingsUpdate }) {
  const [localSettings, setLocalSettings] = useState({
    previewTaskCount: 5,
    showCompletedInPreview: false,
    theme: 'light',
    resetEnabled: true,
    resetTime: '06:00',
    resetTimezone: 'UTC',
    resetDays: 'daily',
    customResetDays: [],
    autoCreateTasks: true,
    notificationEmail: false,
    notificationBrowser: true,
    ...userSettings
  });
  const [loading, setLoading] = useState(false);

  // Update local settings when userSettings prop changes
  useEffect(() => {
    setLocalSettings(prevLocal => ({
      ...prevLocal,
      ...userSettings
    }));
  }, [userSettings]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const response = await apiCall('/user/settings', {
        method: 'PUT',
        body: JSON.stringify({
          preview_task_count: localSettings.previewTaskCount,
          show_completed_in_preview: localSettings.showCompletedInPreview,
          theme: localSettings.theme,
          reset_enabled: localSettings.resetEnabled,
          reset_time: localSettings.resetTime,
          reset_timezone: localSettings.resetTimezone,
          reset_days: localSettings.resetDays,
          custom_reset_days: localSettings.customResetDays,
          auto_create_tasks: localSettings.autoCreateTasks,
          notification_email: localSettings.notificationEmail,
          notification_browser: localSettings.notificationBrowser
        })
      });
      
      if (response.ok) {
        setUserSettings(localSettings);
        onSettingsUpdate();
        onClose();
      } else {
        alert('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error saving settings');
    } finally {
      setLoading(false);
    }
  };

  const handleManualReset = async () => {
    if (!window.confirm('Are you sure you want to reset all tasks? This will create new task instances for today.')) {
      return;
    }

    try {
      const response = await apiCall('/user/reset', { method: 'POST' });
      if (response.ok) {
        const result = await response.json();
        alert('Manual reset completed! ' + result.tasksCreated + ' tasks created.');
        onSettingsUpdate();
      } else {
        alert('Failed to reset tasks');
      }
    } catch (error) {
      console.error('Error during manual reset:', error);
      alert('Error during manual reset');
    }
  };

  const timezones = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    'Australia/Sydney', 'Pacific/Auckland'
  ];

  const weekdays = [
    { value: 'sunday', label: 'Sunday' },
    { value: 'monday', label: 'Monday' },
    { value: 'tuesday', label: 'Tuesday' },
    { value: 'wednesday', label: 'Wednesday' },
    { value: 'thursday', label: 'Thursday' },
    { value: 'friday', label: 'Friday' },
    { value: 'saturday', label: 'Saturday' }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>User Settings</h2>
          <p>Customize your task manager experience</p>
        </div>
        
        <div className="settings-content">
          {/* Appearance Settings */}
          <div className="settings-section">
            <h3>Appearance</h3>
            <div className="form-group">
              <label>Theme</label>
              <select 
                value={localSettings.theme} 
                onChange={(e) => setLocalSettings({...localSettings, theme: e.target.value})}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>

          {/* Task Display Settings */}
          <div className="settings-section">
            <h3>Task Display</h3>
            <div className="form-group">
              <label>Tasks to show in list previews</label>
              <input
                type="number"
                min="1"
                max="20"
                value={localSettings.previewTaskCount}
                onChange={(e) => setLocalSettings({
                  ...localSettings, 
                  previewTaskCount: parseInt(e.target.value) || 5
                })}
              />
              <small>Number of tasks to display in each list preview</small>
            </div>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localSettings.showCompletedInPreview}
                  onChange={(e) => setLocalSettings({
                    ...localSettings, 
                    showCompletedInPreview: e.target.checked
                  })}
                />
                Include completed tasks in previews
              </label>
            </div>
          </div>

          {/* Reset Schedule Settings */}
          <div className="settings-section">
            <h3>Reset Schedule</h3>
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localSettings.resetEnabled}
                  onChange={(e) => setLocalSettings({
                    ...localSettings, 
                    resetEnabled: e.target.checked
                  })}
                />
                Enable automatic daily reset
              </label>
            </div>
            
            {localSettings.resetEnabled && (
              <React.Fragment>
                <div className="form-row">
                  <div className="form-group">
                    <label>Reset Time</label>
                    <input
                      type="time"
                      value={localSettings.resetTime}
                      onChange={(e) => setLocalSettings({
                        ...localSettings, 
                        resetTime: e.target.value
                      })}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Timezone</label>
                    <select
                      value={localSettings.resetTimezone}
                      onChange={(e) => setLocalSettings({
                        ...localSettings, 
                        resetTimezone: e.target.value
                      })}
                    >
                      {timezones.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Reset frequency</label>
                  <select
                    value={localSettings.resetDays}
                    onChange={(e) => setLocalSettings({
                      ...localSettings, 
                      resetDays: e.target.value
                    })}
                  >
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays only (Mon-Fri)</option>
                    <option value="weekends">Weekends only (Sat-Sun)</option>
                    <option value="custom">Custom days</option>
                  </select>
                </div>

                {localSettings.resetDays === 'custom' && (
                  <div className="form-group">
                    <label>Select days for reset</label>
                    <div className="weekday-selector">
                      {weekdays.map(day => (
                        <label key={day.value} className="weekday-checkbox">
                          <input
                            type="checkbox"
                            checked={localSettings.customResetDays.includes(day.value)}
                            onChange={(e) => {
                              const newDays = e.target.checked
                                ? [...localSettings.customResetDays, day.value]
                                : localSettings.customResetDays.filter(d => d !== day.value);
                              setLocalSettings({
                                ...localSettings,
                                customResetDays: newDays
                              });
                            }}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localSettings.autoCreateTasks}
                      onChange={(e) => setLocalSettings({
                        ...localSettings, 
                        autoCreateTasks: e.target.checked
                      })}
                    />
                    Automatically create daily tasks from templates
                  </label>
                </div>
              </React.Fragment>
            )}
          </div>

          {/* Notification Settings */}
          <div className="settings-section">
            <h3>Notifications</h3>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localSettings.notificationEmail}
                  onChange={(e) => setLocalSettings({
                    ...localSettings, 
                    notificationEmail: e.target.checked
                  })}
                />
                Email notifications
              </label>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localSettings.notificationBrowser}
                  onChange={(e) => setLocalSettings({
                    ...localSettings, 
                    notificationBrowser: e.target.checked
                  })}
                />
                Browser notifications
              </label>
            </div>
          </div>

          {/* Manual Actions */}
          <div className="settings-section">
            <h3>Manual Actions</h3>
            
            <div className="form-group">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleManualReset}
              >
                Reset Tasks Now
              </button>
              <small>Create today's tasks immediately (if not already created)</small>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button 
            onClick={onClose} 
            className="btn btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button 
            onClick={handleSave} 
            className="btn btn-primary"
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UserSettings;