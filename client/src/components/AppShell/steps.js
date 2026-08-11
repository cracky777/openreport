import { TbDatabase, TbStack3, TbLayoutDashboard } from 'react-icons/tb';

// The three stages of the data journey, left to right. Order matters: it is
// what gives the carousel its direction and what `stepIndexOf` reads.
export const STEPS = [
  { key: 'sources', label: 'Data Sources', path: '/datasources', icon: TbDatabase },
  { key: 'models', label: 'Data Models', path: '/models', icon: TbStack3 },
  { key: 'reports', label: 'Reports', path: '/', icon: TbLayoutDashboard },
];

export function stepIndexOf(key) {
  return STEPS.findIndex((s) => s.key === key);
}
