import BarWidget from './BarWidget';
import LineWidget from './LineWidget';
import PieWidget from './PieWidget';
import TableWidget from './TableWidget';
import ScorecardWidget from './ScorecardWidget';
import TextWidget from './TextWidget';

export const WIDGET_TYPES = {
  bar: { component: BarWidget, label: 'Bar Chart', icon: '📊', defaultSize: { w: 6, h: 4 } },
  line: { component: LineWidget, label: 'Line Chart', icon: '📈', defaultSize: { w: 6, h: 4 } },
  pie: { component: PieWidget, label: 'Pie Chart', icon: '🥧', defaultSize: { w: 4, h: 4 } },
  table: { component: TableWidget, label: 'Table', icon: '📋', defaultSize: { w: 6, h: 4 } },
  scorecard: { component: ScorecardWidget, label: 'Scorecard', icon: '🔢', defaultSize: { w: 3, h: 2 } },
  text: { component: TextWidget, label: 'Text', icon: '📝', defaultSize: { w: 4, h: 2 } },
};

export { BarWidget, LineWidget, PieWidget, TableWidget, ScorecardWidget, TextWidget };
