import { useEffect, useRef } from 'react';

/**
 * Escape closes only the top layer.
 *
 * Every modal used to add its own document keydown listener, so one Escape
 * reached all of them: closing an open card also closed its board, and
 * closing Edit Task also closed its list. Layers now register here, in the
 * order they open, and one listener calls only the most recent.
 *
 * Layers that mount in the same commit register child first (React runs
 * child effects before parent ones); none of the app's stacked modals do,
 * since each opens on a later user action or data load.
 */

const layers = [];

function onKeyDown(e) {
  if (e.key !== 'Escape' || layers.length === 0) return;
  layers[layers.length - 1].current(e);
}

/** Register a layer; returns its removal. `target` is for tests. */
export function pushEscapeLayer(handlerRef, target = document) {
  if (layers.length === 0) target.addEventListener('keydown', onKeyDown);
  layers.push(handlerRef);
  return () => {
    const i = layers.lastIndexOf(handlerRef);
    if (i !== -1) layers.splice(i, 1);
    if (layers.length === 0) target.removeEventListener('keydown', onKeyDown);
  };
}

/** Call handler on Escape while this component is the top layer. */
export function useEscapeKey(handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => (active ? pushEscapeLayer(ref) : undefined), [active]);
}
