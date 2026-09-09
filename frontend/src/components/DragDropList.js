import React, { useState, useRef, useCallback } from 'react';

// DragDropList – reorderable list that works on both mouse and touch.
//
// Uses the Pointer Events API so mouse, touch, and stylus all work.
//
// IMPORTANT: setPointerCapture is deferred until the pointer has moved
// beyond DRAG_THRESHOLD_PX.  Capturing the pointer on pointerdown
// redirects the browser's click target to the capturing element, which
// swallows onClick handlers on child elements (the list cards' onClick
// never fires).  Deferring capture lets simple clicks propagate
// normally while still capturing once a real drag begins.

const DRAG_THRESHOLD_PX = 5;

function DragDropList({ items, onReorder, renderItem, itemKey = 'id', className = '', isGrid = false }) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Map from item key → DOM element so we can do hit-testing in pointermove.
  const itemRefs = useRef({});
  // The item container element.
  const containerRef = useRef(null);
  // Pending drag: recorded on pointerdown, promoted to a real drag once
  // the pointer moves beyond the threshold.
  const pendingDrag = useRef(null);

  // Find which list slot the pointer is over by checking bounding boxes.
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

    // Record the intent but do NOT capture yet.  Capturing on pointerdown
    // eats the click event that child onClick handlers depend on.
    pendingDrag.current = {
      index,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      target: e.currentTarget,
    };
  }, []);

  const handlePointerMove = useCallback((e, _index) => {
    if (!e.isPrimary) return;

    // If we have a pending (not yet started) drag, check the threshold.
    if (pendingDrag.current && draggedIndex === null) {
      const dx = e.clientX - pendingDrag.current.startX;
      const dy = e.clientY - pendingDrag.current.startY;
      if (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD_PX) {
        // Promote to a real drag: capture the pointer now.
        pendingDrag.current.target.setPointerCapture(pendingDrag.current.pointerId);
        setDraggedIndex(pendingDrag.current.index);
        setDragOverIndex(pendingDrag.current.index);
      }
      return;
    }

    if (draggedIndex === null) return;
    const over = indexFromPoint(e.clientX, e.clientY);
    if (over !== null) setDragOverIndex(over);
  }, [draggedIndex, indexFromPoint]);

  const handlePointerUp = useCallback((e, _index) => {
    if (!e.isPrimary) return;

    // Clear the pending drag regardless.
    pendingDrag.current = null;

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
    pendingDrag.current = null;
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
