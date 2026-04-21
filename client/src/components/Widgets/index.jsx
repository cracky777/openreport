import BarWidget from './BarWidget';
import LineWidget from './LineWidget';
import PieWidget from './PieWidget';
import TableWidget from './TableWidget';
import ScorecardWidget from './ScorecardWidget';
import TextWidget from './TextWidget';
import FilterWidget from './FilterWidget';
import PivotTableWidget from './PivotTableWidget';
import ShapeWidget from './ShapeWidget';
import ScatterWidget from './ScatterWidget';
import ComboWidget from './ComboWidget';
import GaugeWidget from './GaugeWidget';
import TreeMapWidget from './TreeMapWidget';

import { TbChartBar, TbChartLine, TbChartPie, TbChartBubble, TbTable, TbLayoutGrid, TbHash, TbFilter, TbTypography, TbChartAreaLine, TbChartColumn, TbChartHistogram, TbChartBarPopular, TbShape, TbTypography as TbText, TbMinus, TbSquare, TbCircle, TbArrowRight, TbGauge, TbChartTreemap } from 'react-icons/tb';

export const WIDGET_TYPES = {
  bar: { component: BarWidget, label: 'Bar Chart', icon: TbChartBar, defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  line: { component: LineWidget, label: 'Line Chart', icon: TbChartLine, defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  combo: { component: ComboWidget, label: 'Combo Chart', icon: TbChartHistogram, defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  pie: { component: PieWidget, label: 'Pie Chart', icon: TbChartPie, defaultSize: { w: 16, h: 16 } },
  table: { component: TableWidget, label: 'Table', icon: TbTable, defaultSize: { w: 24, h: 16 }, hasSubTypes: true },
  pivotTable: { component: PivotTableWidget, label: 'Pivot Table', icon: TbLayoutGrid, defaultSize: { w: 28, h: 18 }, hidden: true },
  scatter: { component: ScatterWidget, label: 'Scatter Chart', icon: TbChartBubble, defaultSize: { w: 24, h: 16 } },
  treemap: { component: TreeMapWidget, label: 'TreeMap', icon: TbChartTreemap, defaultSize: { w: 24, h: 16 } },
  scorecard: { component: ScorecardWidget, label: 'Scorecard', icon: TbHash, defaultSize: { w: 12, h: 8 } },
  gauge: { component: GaugeWidget, label: 'Gauge', icon: TbGauge, defaultSize: { w: 14, h: 12 }, hasSubTypes: true },
  filter: { component: FilterWidget, label: 'Filter', icon: TbFilter, defaultSize: { w: 10, h: 16 } },
  text: { component: TextWidget, label: 'Text', icon: TbTypography, defaultSize: { w: 16, h: 6 } },
  shape: { component: ShapeWidget, label: 'Shape', icon: TbShape, defaultSize: { w: 200, h: 200 }, hidden: true },
};

export const OBJECT_SUB_TYPES = [
  { value: 'obj_text', label: 'Text', icon: TbText, type: 'text' },
  { value: 'obj_line', label: 'Line', icon: TbMinus, type: 'shape', size: { w: 300, h: 30 }, config: { shape: 'line', transparentBg: true, borderEnabled: false, borderRadius: 0 } },
  { value: 'obj_square', label: 'Square', icon: TbSquare, type: 'shape', config: { shape: 'square', backgroundColor: '#7c3aed', borderColor: '#6d28d9' } },
  { value: 'obj_round', label: 'Round', icon: TbCircle, type: 'shape', config: { shape: 'round', backgroundColor: '#7c3aed', borderColor: '#6d28d9' } },
  { value: 'obj_arrow', label: 'Arrow', icon: TbArrowRight, type: 'shape', config: { shape: 'arrow', transparentBg: true, borderEnabled: false } },
];

export const BAR_SUB_TYPES = [
  { value: 'grouped', label: 'Clustered Bar', icon: TbChartBar },
  { value: 'stacked', label: 'Stacked Bar', icon: TbChartColumn },
  { value: 'stacked100', label: '100% Stacked Bar', icon: TbChartBarPopular },
];

export const TABLE_SUB_TYPES = [
  { value: 'table', label: 'Table', icon: TbTable },
  { value: 'pivotTable', label: 'Pivot Table', icon: TbLayoutGrid },
];

export const COMBO_SUB_TYPES = [
  { value: 'stackedCombo', label: 'Line + Stacked Bar', icon: TbChartHistogram },
  { value: 'clusteredCombo', label: 'Line + Clustered Bar', icon: TbChartHistogram },
];

export const LINE_SUB_TYPES = [
  { value: 'line', label: 'Line', icon: TbChartLine },
  { value: 'area', label: 'Area', icon: TbChartAreaLine },
  { value: 'stackedArea', label: 'Stacked Area', icon: TbChartAreaLine },
  { value: 'stackedArea100', label: '100% Stacked Area', icon: TbChartAreaLine },
];

export const GAUGE_SUB_TYPES = [
  { value: 'arc', label: 'Arc', icon: TbGauge },
  { value: 'column', label: 'Column', icon: TbChartBar },
];

export { BarWidget, LineWidget, PieWidget, ScatterWidget, ComboWidget, TableWidget, ScorecardWidget, TextWidget, FilterWidget, PivotTableWidget, GaugeWidget, TreeMapWidget };
