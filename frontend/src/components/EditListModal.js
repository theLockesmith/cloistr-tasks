import React, { useState, useEffect } from 'react';
import IconPicker from './IconPicker';

function EditListModal({ list, onClose, onSave, onDelete, apiCall }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    icon: '',
    color: '#2dd4bf',
    listType: 'recurring',
    resetEnabled: true,
    resetTime: '06:00',
    resetDays: 'daily',
    customResetDays: []
  });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (list) {
      setFormData({
        name: list.name || '',
        description: list.description || '',
        icon: list.icon || '',
        color: list.color || '#2dd4bf',
        listType: list.list_type || 'recurring',
        resetEnabled: list.reset_enabled !== false,
        resetTime: list.reset_time || '06:00',
        resetDays: list.reset_days || 'daily',
        customResetDays: list.custom_reset_days || []
      });
    }
  }, [list]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const response = await apiCall('/lists/' + list.id, {
        method: 'PUT',
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          icon: formData.icon || formData.name.charAt(0).toUpperCase(),
          color: formData.color,
          list_type: formData.listType,
          reset_enabled: formData.resetEnabled,
          reset_time: formData.resetTime,
          reset_days: formData.resetDays,
          custom_reset_days: formData.customResetDays
        })
      });
      
      if (response.ok) {
        const updatedList = await response.json();
        onSave(updatedList);
      } else {
        alert('Failed to update list');
      }
    } catch (error) {
      console.error('Error updating list:', error);
      alert('Error updating list');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this list? This will permanently delete all tasks and templates in this list.')) {
      return;
    }

    setDeleting(true);
    try {
      const response = await apiCall('/lists/' + list.id, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        onDelete();
      } else {
        alert('Failed to delete list');
      }
    } catch (error) {
      console.error('Error deleting list:', error);
      alert('Error deleting list');
    } finally {
      setDeleting(false);
    }
  };

  const weekdays = [
    { value: 'monday', label: 'Monday' },
    { value: 'tuesday', label: 'Tuesday' },
    { value: 'wednesday', label: 'Wednesday' },
    { value: 'thursday', label: 'Thursday' },
    { value: 'friday', label: 'Friday' },
    { value: 'saturday', label: 'Saturday' },
    { value: 'sunday', label: 'Sunday' }
  ];

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal large" onClick={e => e.stopPropagation()}>
        <h3>Edit List</h3>
        
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
            <IconPicker
              value={formData.icon}
              onChange={(icon) => setFormData({...formData, icon})}
              color={formData.color}
            />

            <div className="form-group">
              <label>Icon Color</label>
              <input
                type="color"
                value={formData.color}
                onChange={e => setFormData({...formData, color: e.target.value})}
                className="color-picker-square"
              />
            </div>
          </div>

          <div className="form-group">
            <label>List Type</label>
            <select
              value={formData.listType}
              onChange={e => setFormData({...formData, listType: e.target.value})}
            >
              <option value="recurring">Recurring Tasks (reset daily)</option>
              <option value="completion">Completion List (check off once)</option>
            </select>
            <small>Recurring tasks reset daily, completion lists stay checked when done</small>
          </div>

          {formData.listType === 'recurring' && (
            <React.Fragment>
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.resetEnabled}
                    onChange={e => setFormData({...formData, resetEnabled: e.target.checked})}
                  />
                  Enable automatic reset for this list
                </label>
              </div>

              {formData.resetEnabled && (
                <React.Fragment>
                  <div className="form-group">
                    <label>Reset time</label>
                    <input
                      type="time"
                      value={formData.resetTime}
                      onChange={e => setFormData({...formData, resetTime: e.target.value})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Reset frequency</label>
                    <select
                      value={formData.resetDays}
                      onChange={e => setFormData({...formData, resetDays: e.target.value})}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekdays">Weekdays only</option>
                      <option value="weekends">Weekends only</option>
                      <option value="custom">Custom days</option>
                    </select>
                  </div>

                  {formData.resetDays === 'custom' && (
                    <div className="form-group">
                      <label>Select days for reset</label>
                      <div className="weekday-selector">
                        {weekdays.map(day => (
                          <label key={day.value} className="weekday-checkbox">
                            <input
                              type="checkbox"
                              checked={formData.customResetDays.includes(day.value)}
                              onChange={(e) => {
                                const newDays = e.target.checked
                                  ? [...formData.customResetDays, day.value]
                                  : formData.customResetDays.filter(d => d !== day.value);
                                setFormData({...formData, customResetDays: newDays});
                              }}
                            />
                            {day.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              )}
            </React.Fragment>
          )}
          
          <div className="modal-actions">
            <button 
              type="button" 
              onClick={handleDelete} 
              className="btn btn-danger" 
              disabled={loading || deleting}
            >
              {deleting ? 'Deleting...' : 'Delete List'}
            </button>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading || deleting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || deleting}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditListModal;