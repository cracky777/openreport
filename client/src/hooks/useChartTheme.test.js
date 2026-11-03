import { describe, it, expect, vi, afterEach } from 'vitest';
import { readChartTheme } from './useChartTheme';

const themed = (vars) => vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name) => vars[name] || '' }));

describe('readChartTheme', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The surfaces the server colours a map or a gauge with (colorScheme.js
  // SURFACES): left to its defaults, a map added to a dark report kept white land.
  it('gives a dark report a dark track and its card as the panel', () => {
    themed({ '--bg-panel': '#111827', '--border-default': '#1e293b', '--border-strong': '#334155', '--text-primary': '#f1f5f9' });
    expect(readChartTheme({})).toMatchObject({ panel: '#111827', track: '#334155' });
  });

  it('gives a light report a pale track on a white card', () => {
    themed({ '--bg-panel': '#ffffff', '--border-default': '#e2e8f0', '--border-strong': '#cbd5e1', '--text-primary': '#0f172a' });
    expect(readChartTheme({})).toMatchObject({ panel: '#ffffff', track: '#e2e8f0' });
  });

  it('falls back to the light theme outside a report', () => {
    expect(readChartTheme(null)).toMatchObject({ panel: '#ffffff', track: '#e2e8f0' });
  });
});
