import React, { useState, useEffect } from 'react';

function AddTaskModal({ listId, onClose, onSave, apiCall }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    timeSlot: '',
    estimatedMinutes: ''
  });
  const [loading, setLoading] = useState(false);

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
      const response = await apiCall('/lists/' + listId + '/templates', {
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

export default AddTaskModal;