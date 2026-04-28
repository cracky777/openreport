import { useState, useCallback, useRef } from 'react';

export function useHistory(initialState) {
  const [state, setState] = useState(initialState);
  // stateRef always mirrors the latest React state so callers can compute `next` synchronously.
  const stateRef = useRef(initialState);
  stateRef.current = state;
  const historyRef = useRef([initialState]);
  const indexRef = useRef(0);

  const pushToHistory = (next) => {
    historyRef.current = historyRef.current.slice(0, indexRef.current + 1);
    historyRef.current.push(next);
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    } else {
      indexRef.current++;
    }
  };

  // Record-and-update. Computes the next state here, pushes to history BEFORE setState.
  // Uses plain setState(value) — no updater — so StrictMode never double-invokes it.
  const set = useCallback((updater) => {
    const prev = stateRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    pushToHistory(next);
    stateRef.current = next;
    setState(next);
  }, []);

  // Update state without recording (transient/derived updates).
  const setSilent = useCallback((updater) => {
    const prev = stateRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    if (next === prev) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const undo = useCallback(() => {
    if (indexRef.current > 0) {
      indexRef.current--;
      const next = historyRef.current[indexRef.current];
      stateRef.current = next;
      setState(next);
    }
  }, []);

  const redo = useCallback(() => {
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current++;
      const next = historyRef.current[indexRef.current];
      stateRef.current = next;
      setState(next);
    }
  }, []);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < historyRef.current.length - 1;

  return { state, set, setSilent, undo, redo, canUndo, canRedo };
}
