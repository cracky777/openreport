import BarWidget from './BarWidget';
import LineWidget from './LineWidget';
import PieWidget from './PieWidget';
import TableWidget from './TableWidget';
import ScorecardWidget from './ScorecardWidget';
import TextWidget from './TextWidget';
import FilterWidget from './FilterWidget';
import PivotTableWidget from './PivotTableWidget';

import { TbChartBar, TbChartLine, TbChartPie, TbTable, TbLayoutGrid, TbHash, TbFilter, TbTypography, TbChartAreaLine, TbChartColumn, TbChartHistogram } from 'react-icons/tb';

export const WIDGET_TYPES = {
  bar: { component: BarWidget, label: 'Bar Chart', icon: TbChartBar, defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  line: { component: LineWidget, label: 'Line Chart', icon: TbChartLine, defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  pie: { component: PieWidget, label: 'Pie Chart', icon: TbChartPie, defaultSize: { w: 16, h: 16 } },
  table: { component: TableWidget, label: 'Table', icon: TbTable, defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  pivotTable: { component: PivotTableWidget, label: 'Pivot Table', icon: TbLayoutGrid, defaultSize: { w: 28, h: 18 }, hidden: true },
  scorecard: { component: ScorecardWidget, label: 'Scorecard', icon: TbHash, defaultSize: { w: 12, h: 8 } },
  filter: { component: FilterWidget, label: 'Filter', icon: TbFilter, defaultSize: { w: 10, h: 16 } },
  text: { component: TextWidget, label: 'Text', icon: TbTypography, defaultSize: { w: 16, h: 6 } },
};

export const BAR_SUB_TYPES = [
  { value: 'grouped', label: 'Clustered Bar', icon: TbChartBar },
  { value: 'stacked', label: 'Stacked Bar', icon: TbChartColumn },
  { value: 'stacked100', label: '100% Stacked Bar', icon: TbChartHistogram },
];

export const TABLE_SUB_TYPES = [
  { value: 'table', label: 'Table', icon: TbTable },
  { value: 'pivotTable', label: 'Pivot Table', icon: TbLayoutGrid },
];

export const LINE_SUB_TYPES = [
  { value: 'line', label: 'Line', icon: TbChartLine },
  { value: 'area', label: 'Area', icon: TbChartAreaLine },
  { value: 'stackedArea', label: 'Stacked Area', icon: TbChartAreaLine },
  { value: 'stackedArea100', label: '100% Stacked Area', icon: TbChartAreaLine },
];

export { BarWidget, LineWidget, PieWidget, TableWidget, ScorecardWidget, TextWidget, FilterWidget, PivotTableWidget };
