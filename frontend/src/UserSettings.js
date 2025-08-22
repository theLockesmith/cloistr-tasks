// frontend/src/UserSettings.js
// User settings component for reset schedules and preferences

import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

const UserSettings = ({ onClose }) => {
  const { apiCall, user } = useAuth();
  const [settings, setSettings] = useState({
    reset_enabled: true,
    reset_time: '06:00',
    reset_timezone: 'UTC',
    reset_days: 'daily',
    custom_reset_days: [],
    auto_create_tasks: true,
    theme: 'light',
    notification_email: false,
    notification_browser: true
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load user settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await apiCall('/user/profile');
        if (response.ok) {
          const userData = await response.json();
          setSettings({
            reset_enabled: userData.reset_enabled ?? true,
            reset_time: userData.reset_time ?? '06:00',
            reset_timezone: userData.reset_timezone ?? 'UTC',
            reset_days: userData.reset_days ?? 'daily',
            custom_reset_days: userData.custom_reset_days ?? [],
            auto_create_tasks: userData.auto_create_tasks ?? true,
            theme: userData.theme ?? 'light',
            notification_email: userData.notification_email ?? false,
            notification_browser: userData.notification_browser ?? true
          });
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [apiCall]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await apiCall('/user/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });

      if (response.ok) {
        alert('Settings saved successfully!');
        onClose();
      } else {
        alert('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleManualReset = async () => {
    try {
      const response = await apiCall('/user/reset', { method: 'POST' });
      if (response.ok) {
        const result = await response.json();
        alert(`Manual reset completed! ${result.tasksCreated} tasks created.`);
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
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' }
  ];

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal large" onClick={e => e.stopPropagation()}>
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ User Settings</h2>
          <p>Welcome, {user?.firstName || user?.username}!</p>
        </div>

        <div className="settings-content">
          {/* Reset Schedule Settings */}
          <div className="settings-section">
            <h3>🔄 Reset Schedule</h3>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.reset_enabled}
                  onChange={e => setSettings({...settings, reset_enabled: e.target.checked})}
                />
                Enable automatic daily reset
              </label>
            </div>

            {settings.reset_enabled && (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>Reset Time</label>
                    <input
                      type="time"
                      value={settings.reset_time}
                      onChange={e => setSettings({...settings, reset_time: e.target.value})}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Timezone</label>
                    <select
                      value={settings.reset_timezone}
                      onChange={e => setSettings({...settings, reset_timezone: e.target.value})}
                    >
                      {timezones.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Reset Days</label>
                  <select
                    value={settings.reset_days}
                    onChange={e => setSettings({...settings, reset_days: e.target.value})}
                  >
                    <option value="daily">Every day</option>
                    <option value="weekdays">Weekdays only (Mon-Fri)</option>
                    <option value="weekends">Weekends only (Sat-Sun)</option>
                    <option value="custom">Custom days</option>
                  </select>
                </div>

                {settings.reset_days === 'custom' && (
                  <div className="form-group">
                    <label>Custom Days</label>
                    <div className="weekday-selector">
                      {weekdays.map(day => (
                        <label key={day.value} className="weekday-checkbox">
                          <input
                            type="checkbox"
                            checked={settings.custom_reset_days.includes(day.value)}
                            onChange={e => {
                              if (e.target.checked) {
                                setSettings({
                                  ...settings,
                                  custom_reset_days: [...settings.custom_reset_days, day.value]
                                });
                              } else {
                                setSettings({
                                  ...settings,
                                  custom_reset_days: settings.custom_reset_days.filter(d => d !== day.value)
                                });
                              }
                            }}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.auto_create_tasks}
                  onChange={e => setSettings({...settings, auto_create_tasks: e.target.checked})}
                />
                Automatically create daily tasks from templates
              </label>
            </div>
          </div>

          {/* Appearance Settings */}
          <div className="settings-section">
            <h3>🎨 Appearance</h3>
            
            <div className="form-group">
              <label>Theme</label>
              <select
                value={settings.theme}
                onChange={e => setSettings({...settings, theme: e.target.value})}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Auto (system preference)</option>
              </select>
            </div>
          </div>

          {/* Notification Settings */}
          <div className="settings-section">
            <h3>🔔 Notifications</h3>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.notification_email}
                  onChange={e => setSettings({...settings, notification_email: e.target.checked})}
                />
                Email notifications
              </label>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.notification_browser}
                  onChange={e => setSettings({...settings, notification_browser: e.target.checked})}
                />
                Browser notifications
              </label>
            </div>
          </div>

          {/* Manual Actions */}
          <div className="settings-section">
            <h3>🔧 Manual Actions</h3>
            
            <div className="form-group">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleManualReset}
              >
                🔄 Reset Tasks Now
              </button>
              <small>Create today's tasks immediately (if not already created)</small>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button 
            type="button" 
            onClick={onClose} 
            className="btn btn-secondary"
            disabled={saving}
          >
            Cancel
          </button>
          <button 
            type="button" 
            onClick={handleSave} 
            className="btn btn-primary"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserSettings;