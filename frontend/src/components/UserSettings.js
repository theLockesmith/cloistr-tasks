import React, { useState, useEffect } from 'react';
import {
  isPushSupported,
  getPermissionState,
  getActiveSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push';

function UserSettings({ onClose, apiCall, userSettings, setUserSettings, onSettingsUpdate }) {
  const [localSettings, setLocalSettings] = useState({
    previewTaskCount: 5,
    showCompletedInPreview: true,
    theme: 'system',
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
  const [icalToken, setIcalToken] = useState(null);
  const [icalLoading, setIcalLoading] = useState(false);
  const [icalCopied, setIcalCopied] = useState(false);

  // Push notifications (board activity): separate from the
  // localSettings.notificationBrowser preference above, which is just a
  // stored flag. This tracks the ACTUAL browser subscription state —
  // Notification permission + an active PushSubscription — since that's
  // what determines whether notifications will really arrive.
  const [pushSupported] = useState(isPushSupported());
  const [pushPermission, setPushPermission] = useState(getPermissionState());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState(null);

  useEffect(() => {
    if (!pushSupported) return;
    (async () => {
      try {
        const sub = await getActiveSubscription();
        setPushEnabled(!!sub);
      } catch (e) {
        console.error('Error checking push subscription state:', e);
      }
    })();
  }, [pushSupported]);

  // Update local settings when userSettings prop changes
  useEffect(() => {
    setLocalSettings(prevLocal => ({
      ...prevLocal,
      ...userSettings
    }));
  }, [userSettings]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiCall('/user/ical-token');
        if (res.ok) {
          const data = await res.json();
          setIcalToken(data.ical_token);
        }
      } catch (e) {
        console.error('Error loading iCal token:', e);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const icalFeedUrl = icalToken
    ? `${window.location.origin}/api/ical/${icalToken}.ics`
    : null;

  const generateIcalToken = async () => {
    setIcalLoading(true);
    try {
      const res = await apiCall('/user/ical-token', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setIcalToken(data.ical_token);
      } else {
        alert('Failed to generate feed URL');
      }
    } catch (e) {
      console.error('Error generating iCal token:', e);
      alert('Error generating feed URL');
    } finally {
      setIcalLoading(false);
    }
  };

  const revokeIcalToken = async () => {
    if (!window.confirm('Revoke your calendar feed URL? Any calendar app using it will stop updating.')) return;
    setIcalLoading(true);
    try {
      const res = await apiCall('/user/ical-token', { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        setIcalToken(null);
      } else {
        alert('Failed to revoke feed URL');
      }
    } catch (e) {
      console.error('Error revoking iCal token:', e);
      alert('Error revoking feed URL');
    } finally {
      setIcalLoading(false);
    }
  };

  const handleEnablePush = async () => {
    setPushLoading(true);
    setPushError(null);
    try {
      await subscribeToPush(apiCall);
      setPushEnabled(true);
      setPushPermission(getPermissionState());
    } catch (e) {
      console.error('Error enabling push notifications:', e);
      setPushError(e.message || 'Failed to enable push notifications');
      setPushPermission(getPermissionState());
    } finally {
      setPushLoading(false);
    }
  };

  const handleDisablePush = async () => {
    setPushLoading(true);
    setPushError(null);
    try {
      await unsubscribeFromPush(apiCall);
      setPushEnabled(false);
    } catch (e) {
      console.error('Error disabling push notifications:', e);
      setPushError(e.message || 'Failed to disable push notifications');
    } finally {
      setPushLoading(false);
    }
  };

  const copyIcalUrl = () => {
    if (!icalFeedUrl) return;
    navigator.clipboard.writeText(icalFeedUrl).then(() => {
      setIcalCopied(true);
      setTimeout(() => setIcalCopied(false), 2000);
    });
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

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  disabled={!pushSupported || pushLoading || pushPermission === 'denied'}
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleEnablePush();
                    } else {
                      handleDisablePush();
                    }
                  }}
                />
                Push notifications for board activity
              </label>
              {!pushSupported && (
                <small>Push notifications are not supported in this browser.</small>
              )}
              {pushSupported && pushPermission === 'denied' && (
                <small style={{ color: 'var(--text-secondary)' }}>
                  Notifications are blocked for this site. Allow them in your browser's site settings to enable this.
                </small>
              )}
              {pushSupported && pushPermission !== 'denied' && (
                <small>
                  Get notified in your browser when a shared board gets a new card, a card is moved, or a comment is added.
                </small>
              )}
              {pushError && (
                <small style={{ color: 'var(--danger, #d33)' }}>{pushError}</small>
              )}
            </div>
          </div>

          {/* Data Export/Import */}
          <div className="settings-section">
            <h3>Data</h3>
            <div className="form-group">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    try {
                      const res = await apiCall('/user/export');
                      if (!res.ok) { alert('Export failed'); return; }
                      const data = await res.json();
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `ritual-forge-export-${new Date().toISOString().split('T')[0]}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e) {
                      console.error('Export error:', e);
                      alert('Export failed');
                    }
                  }}
                >
                  Export All Data
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.json';
                    input.onchange = async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      try {
                        const text = await file.text();
                        const data = JSON.parse(text);
                        if (!window.confirm(`Import ${data.lists?.length || 0} lists and ${data.templates?.length || 0} templates? This adds data alongside your existing data.`)) return;
                        const res = await apiCall('/user/import', {
                          method: 'POST',
                          body: JSON.stringify(data),
                        });
                        if (res.ok) {
                          const result = await res.json();
                          alert(`Imported ${result.stats.lists} lists, ${result.stats.templates} templates, ${result.stats.labels} labels.`);
                          onSettingsUpdate();
                        } else {
                          const err = await res.json().catch(() => ({}));
                          alert(err.error || 'Import failed');
                        }
                      } catch (err) {
                        console.error('Import error:', err);
                        alert('Import failed: invalid file');
                      }
                    };
                    input.click();
                  }}
                >
                  Import Data
                </button>
              </div>
              <small>Export downloads all your lists, tasks, boards, and labels as JSON. Import adds data alongside existing data.</small>
            </div>
          </div>

          {/* Calendar Feed */}
          <div className="settings-section">
            <h3>Calendar Feed</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
              Subscribe from any calendar app (Google Calendar, Apple Calendar, etc.) to see tasks with due dates.
            </p>
            {icalFeedUrl ? (
              <div className="form-group">
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    value={icalFeedUrl}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.8rem' }}
                    onClick={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={copyIcalUrl}
                    disabled={icalLoading}
                  >
                    {icalCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={generateIcalToken}
                    disabled={icalLoading}
                  >
                    Regenerate
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-small"
                    onClick={revokeIcalToken}
                    disabled={icalLoading}
                  >
                    Revoke
                  </button>
                </div>
                <small style={{ color: 'var(--text-secondary)' }}>
                  Anyone with this URL can see your task titles and due dates. Revoke it to cut off access.
                </small>
              </div>
            ) : (
              <div className="form-group">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={generateIcalToken}
                  disabled={icalLoading}
                >
                  {icalLoading ? 'Generating...' : 'Generate Feed URL'}
                </button>
                <small>Creates a private URL you can paste into your calendar app.</small>
              </div>
            )}
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