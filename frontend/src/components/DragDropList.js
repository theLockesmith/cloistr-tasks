import React, { useState } from 'react';

// Simple drag and drop implementation without external dependencies
function DragDropList({ items, onReorder, renderItem, itemKey = 'id', className = '', isGrid = false }) {
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleDragStart = (e, item, index) => {
    setDraggedItem({ item, index });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = (e) => {
    // Only clear drag over if we're actually leaving the element
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    
    if (draggedItem && draggedItem.index !== dropIndex) {
      const newItems = [...items];
      const [removed] = newItems.splice(draggedItem.index, 1);
      newItems.splice(dropIndex, 0, removed);
      
      onReorder(newItems);
    }
    
    setDraggedItem(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverIndex(null);
  };

  const listClassName = isGrid ? 'drag-drop-grid' : 'drag-drop-list';

  return (
    <div className={listClassName + ' ' + className}>
      {items.map((item, index) => (
        <div
          key={item[itemKey]}
          draggable
          onDragStart={(e) => handleDragStart(e, item, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, index)}
          onDragEnd={handleDragEnd}
          className={`drag-drop-item ${
            draggedItem && draggedItem.index === index ? 'dragging' : ''
          } ${
            dragOverIndex === index ? 'drag-over' : ''
          }`}
          style={{
            opacity: draggedItem && draggedItem.index === index ? 0.5 : 1,
          }}
        >
          <div className="drag-content">
            {renderItem(item, index)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default DragDropList;