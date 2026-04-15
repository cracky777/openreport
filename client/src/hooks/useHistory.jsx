import { useState, useCallback, useRef } from 'react';

export function useHistory(initialState) {
  const [state, setState] = useState(initialState);
  const historyRef = useRef([initialState]);
  const indexRef = useRef(0);
  const skipRecordRef = useRef(false);

  const set = useCallback((updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;

      if (!skipRecordRef.current) {
        // Truncate future history
        historyRef.current = historyRef.current.slice(0, indexRef.current + 1);
        historyRef.current.push(next);
        // Keep max 50 entries
        if (historyRef.current.length > 50) {
          historyRef.current.shift();
        } else {
          indexRef.current++;
        }
      }
      skipRecordRef.current = false;

      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (indexRef.current > 0) {
      indexRef.current--;
      skipRecordRef.current = true;
      setState(historyRef.current[indexRef.current]);
    }
  }, []);

  const redo = useCallback(() => {
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current++;
      skipRecordRef.current = true;
      setState(historyRef.current[indexRef.current]);
    }
  }, []);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < historyRef.current.length - 1;

  return { state, set, undo, redo, canUndo, canRedo };
}
