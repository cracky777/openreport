import { SourcesIcon, ModelsIcon, ReportsIcon } from './StageIcons';

// The three stages of the data journey, left to right. Order matters: it is
// what gives the carousel its direction and what `stepIndexOf` reads.
export const STEPS = [
  { key: 'sources', label: 'Data Sources', path: '/datasources', icon: SourcesIcon },
  { key: 'models', label: 'Data Models', path: '/models', icon: ModelsIcon },
  { key: 'reports', label: 'Reports', path: '/', icon: ReportsIcon },
];

export function stepIndexOf(key) {
  return STEPS.findIndex((s) => s.key === key);
}
