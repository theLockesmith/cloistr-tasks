import React, { useState, useEffect } from 'react';

function EditTaskModal({ task, onClose, onSave, onDelete, apiCall }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    timeSlot: '',
    estimatedMinutes: ''
  });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (task) {
      setFormData({
        name: task.template_name || '',
        description: task.template_description || '',
        timeSlot: task.time_slot || '',
        estimatedMinutes: task.estimated_minutes || ''
      });
    }
  }, [task]);

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
      const response = await apiCall('/templates/' + task.template_id, {
        method: 'PUT',
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        onSave();
      } else {
        alert('Failed to update task');
      }
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Error updating task');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this task template? This will remove it from all future days.')) {
      return;
    }

    setDeleting(true);
    try {
      const response = await apiCall('/templates/' + task.template_id, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        onDelete();
      } else {
        alert('Failed to delete task');
      }
    } catch (error) {
      console.error('Error deleting task:', error);
      alert('Error deleting task');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Edit Task</h3>
        
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
            <button 
              type="button" 
              onClick={handleDelete} 
              className="btn btn-danger" 
              disabled={loading || deleting}
            >
              {deleting ? 'Deleting...' : 'Delete Task'}
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

export default EditTaskModal;