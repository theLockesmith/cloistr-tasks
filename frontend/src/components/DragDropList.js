import React, { useState, useRef, useCallback } from 'react';

// DragDropList – reorderable list that works on both mouse and touch.
//
// The previous implementation used HTML5 drag events (onDragStart, onDrop,
// etc.) which never fire on touch devices, so mobile users had no way to
// reorder items.  This version uses the Pointer Events API instead; pointer
// events fire for mouse, touch, and stylus uniformly.
//
// The algorithm:
//   pointerdown – record which item the user grabbed and lock pointer capture
//     so we keep receiving events even if the pointer leaves the element.
//   pointermove – compute which slot the pointer is over and update
//     dragOverIndex so we can show the drop indicator.
//   pointerup / pointercancel – commit or discard the reorder.
//
// We use CSS `touch-action: none` on each draggable item to prevent the
// browser from interpreting the touch as a scroll before we claim it.

function DragDropList({ items, onReorder, renderItem, itemKey = 'id', className = '', isGrid = false }) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Map from item key → DOM element so we can do hit-testing in pointermove.
  const itemRefs = useRef({});
  // The item container element that we attach the move listener to.
  const containerRef = useRef(null);

  // Find which list slot the pointer is over by checking bounding boxes.
  // Returns the index of the slot, or null if outside the list.
  const indexFromPoint = useCallback((clientX, clientY) => {
    let best = null;
    let bestDist = Infinity;
    items.forEach((item, idx) => {
      const el = itemRefs.current[item[itemKey]];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cy = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(clientY - cy);
      if (dist < bestDist) { bestDist = dist; best = idx; }
    });
    return best;
  }, [items, itemKey]);

  const handlePointerDown = useCallback((e, index) => {
    // Only respond to the primary pointer (left mouse button or first touch).
    if (!e.isPrimary) return;
    // Checkboxes and buttons inside the item handle their own events.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggedIndex(index);
    setDragOverIndex(index);
  }, []);

  const handlePointerMove = useCallback((e, _index) => {
    if (draggedIndex === null || !e.isPrimary) return;
    const over = indexFromPoint(e.clientX, e.clientY);
    if (over !== null) setDragOverIndex(over);
  }, [draggedIndex, indexFromPoint]);

  const handlePointerUp = useCallback((e, _index) => {
    if (!e.isPrimary) return;
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const newItems = [...items];
      const [removed] = newItems.splice(draggedIndex, 1);
      newItems.splice(dragOverIndex, 0, removed);
      onReorder(newItems);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, dragOverIndex, items, onReorder]);

  const handlePointerCancel = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const listClassName = isGrid ? 'drag-drop-grid' : 'drag-drop-list';

  return (
    <div ref={containerRef} className={listClassName + ' ' + className}>
      {items.map((item, index) => (
        <div
          key={item[itemKey]}
          ref={(el) => { itemRefs.current[item[itemKey]] = el; }}
          onPointerDown={(e) => handlePointerDown(e, index)}
          onPointerMove={(e) => handlePointerMove(e, index)}
          onPointerUp={(e) => handlePointerUp(e, index)}
          onPointerCancel={handlePointerCancel}
          className={[
            'drag-drop-item',
            draggedIndex === index ? 'dragging' : '',
            dragOverIndex === index && draggedIndex !== index ? 'drag-over' : '',
          ].filter(Boolean).join(' ')}
          style={{
            opacity: draggedIndex === index ? 0.5 : 1,
            touchAction: 'none',
            cursor: draggedIndex !== null ? 'grabbing' : 'grab',
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
