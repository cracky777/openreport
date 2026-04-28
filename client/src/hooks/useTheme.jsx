import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import themesJson from '../themes/themes.json';

// JSON-driven theme system. Add a new theme by inserting an entry in `client/src/themes/themes.json`.
// Each theme exposes a `vars` map of CSS variables that gets applied at runtime to <html> (and to
// the report canvas wrapper for the createdTheme).

const ThemeContext = createContext(null);
const STORAGE_KEY = 'openreport.theme';

function getDefaultThemeKey(themesMap) {
  // Heuristic for the "system" preference: pick the first theme whose `kind` matches the OS scheme.
  if (typeof window === 'undefined' || !window.matchMedia) return Object.keys(themesMap)[0];
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const target = prefersDark ? 'dark' : 'light';
  // First exact match by kind (so we honor a custom dark theme as the system pick if it's listed first)
  const byKind = Object.entries(themesMap).find(([, t]) => t.kind === target)?.[0];
  return byKind || Object.keys(themesMap)[0];
}

function readStoredMode(themesMap) {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'system') return 'system';
    if (v && themesMap[v]) return v;
  } catch { /* ignore */ }
  return 'system';
}

function applyVarsTo(el, themeObj) {
  if (!el || !themeObj?.vars) return;
  for (const [k, v] of Object.entries(themeObj.vars)) el.style.setProperty(k, v);
  el.setAttribute('data-theme', themeObj._key || '');
  if (el === document.documentElement) {
    el.style.colorScheme = themeObj.kind === 'dark' ? 'dark' : 'light';
  }
}

export function ThemeProvider({ children }) {
  // Themes map enriched with their key (so theme objects know their own key)
  const themes = useMemo(() => {
    const out = {};
    for (const [k, t] of Object.entries(themesJson)) out[k] = { ...t, _key: k };
    return out;
  }, []);

  const [mode, setModeState] = useState(() => readStoredMode(themes));
  const [systemKey, setSystemKey] = useState(() => getDefaultThemeKey(themes));

  const resolved = mode === 'system' ? systemKey : mode;
  const activeTheme = themes[resolved] || themes[Object.keys(themes)[0]];

  // Apply vars on <html>
  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyVarsTo(document.documentElement, activeTheme);
  }, [activeTheme]);

  // Track OS-level preference changes (only relevant when mode === 'system')
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystemKey(getDefaultThemeKey(themes));
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, [themes]);

  const setMode = useCallback((next) => {
    setModeState(next);
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    // Cycle between light-ish and dark-ish kinds (or just flip kind if more themes added later)
    const nextKind = activeTheme?.kind === 'dark' ? 'light' : 'dark';
    const target = Object.entries(themes).find(([, t]) => t.kind === nextKind)?.[0];
    if (target) setMode(target);
  }, [activeTheme, themes, setMode]);

  // Helper for callers (e.g. ReportCanvas wrapper) to inline a theme's vars on a specific element.
  const getThemeVars = useCallback((themeKey) => themes[themeKey]?.vars || {}, [themes]);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, toggle, themes, getThemeVars }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
