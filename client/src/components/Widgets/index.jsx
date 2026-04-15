import BarWidget from './BarWidget';
import LineWidget from './LineWidget';
import PieWidget from './PieWidget';
import TableWidget from './TableWidget';
import ScorecardWidget from './ScorecardWidget';
import TextWidget from './TextWidget';
import FilterWidget from './FilterWidget';

export const WIDGET_TYPES = {
  bar: { component: BarWidget, label: 'Bar Chart', icon: '📊', defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  line: { component: LineWidget, label: 'Line Chart', icon: '📈', defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  pie: { component: PieWidget, label: 'Pie Chart', icon: '🥧', defaultSize: { w: 16, h: 16 } },
  table: { component: TableWidget, label: 'Table', icon: '📋', defaultSize: { w: 24, h: 16 } },
  scorecard: { component: ScorecardWidget, label: 'Scorecard', icon: '🔢', defaultSize: { w: 12, h: 8 } },
  filter: { component: FilterWidget, label: 'Filter', icon: '🔽', defaultSize: { w: 10, h: 16 } },
  text: { component: TextWidget, label: 'Text', icon: '📝', defaultSize: { w: 16, h: 6 } },
};

export const BAR_SUB_TYPES = [
  { value: 'grouped', label: 'Clustered Bar' },
  { value: 'stacked', label: 'Stacked Bar' },
  { value: 'stacked100', label: '100% Stacked Bar' },
];

export const LINE_SUB_TYPES = [
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'stackedArea', label: 'Stacked Area' },
  { value: 'stackedArea100', label: '100% Stacked Area' },
];

export { BarWidget, LineWidget, PieWidget, TableWidget, ScorecardWidget, TextWidget, FilterWidget };
