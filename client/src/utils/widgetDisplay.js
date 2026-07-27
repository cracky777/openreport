// Resolve a widget's display label + icon metadata from its type / sub-type.
// Pure helper extracted verbatim from PropertyPanel.jsx (LOT 6.3).
import { WIDGET_TYPES, BAR_SUB_TYPES, LINE_SUB_TYPES, COMBO_SUB_TYPES, TABLE_SUB_TYPES } from '../components/Widgets';

function getWidgetDisplayInfo(widget) {
  if (!widget) return { label: '', icon: null };
  const meta = WIDGET_TYPES[widget.type];
  if (!meta) return { label: widget.type, icon: null };

  // Check sub-types for specific label/icon
  const subType = widget.config?.subType;
  if (widget.type === 'bar' && subType) {
    const st = BAR_SUB_TYPES.find((s) => s.value === subType);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  if (widget.type === 'line' && subType) {
    const st = LINE_SUB_TYPES.find((s) => s.value === subType);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  if (widget.type === 'combo' && subType) {
    const st = COMBO_SUB_TYPES.find((s) => s.value === subType);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  if (widget.type === 'table' || widget.type === 'pivotTable') {
    const st = TABLE_SUB_TYPES.find((s) => s.value === widget.type);
    if (st) return { label: st.label, icon: st.icon || meta.icon };
  }
  return { label: meta.label, icon: meta.icon };
}

export { getWidgetDisplayInfo };
