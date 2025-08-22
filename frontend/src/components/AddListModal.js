import React, { useState, useEffect } from 'react';

function AddListModal({ onClose, onSave, apiCall }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    icon: '',
    color: '#2dd4bf'
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
      const response = await apiCall('/lists', {
        method: 'POST',
        body: JSON.stringify({
          ...formData,
          icon: formData.icon || formData.name.charAt(0).toUpperCase()
        })
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
              placeholder="Icon (emoji or letter)"
              value={formData.icon}
              onChange={e => setFormData({...formData, icon: e.target.value})}
              maxLength={2}
            />
            
            <div className="color-picker-container">
              <label>Icon Color</label>
              <input
                type="color"
                value={formData.color}
                onChange={e => setFormData({...formData, color: e.target.value})}
                className="color-picker-square"
              />
            </div>
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

export default AddListModal;