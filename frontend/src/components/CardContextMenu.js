import React, { useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';

/**
 * Lightweight card context menu, matching the @cloistr/ui ContextMenu API shape.
 * Replace with `import { ContextMenu, useContextMenu } from '@cloistr/ui'` once
 * the package publishes the component (it exists in source but not in 0.41.0).
 */

export function useCardContextMenu() {
  const [state, setState] = React.useState(null);

  const open = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { isOpen: !!state, anchorPoint: state, open, close };
}

export function CardContextMenu({ items, anchorPoint, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!anchorPoint) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [anchorPoint, onClose]);

  useEffect(() => {
    // Clamp to viewport edges.
    if (!ref.current || !anchorPoint) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    let x = anchorPoint.x;
    let y = anchorPoint.y;
    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    ref.current.style.left = x + 'px';
    ref.current.style.top = y + 'px';
  }, [anchorPoint]);

  if (!anchorPoint) return null;

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className="card-context-menu"
      role="menu"
      style={{ left: anchorPoint.x, top: anchorPoint.y }}
    >
      {items.map(item =>
        item.separator ? (
          <div key={item.key} className="card-context-menu-sep" role="separator" />
        ) : (
          <button
            key={item.key}
            role="menuitem"
            className={'card-context-menu-item' + (item.danger ? ' danger' : '')}
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
