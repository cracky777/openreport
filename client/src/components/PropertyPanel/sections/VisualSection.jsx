// Section 4 — the section named after the visual. Its geometry and its
// behaviour, and nothing else: no colour, no text, no frame. Open by
// default, since it is the one people look for first.
import { Section, SubSection, Field, RangeInput, ColorInput, DecimalInput, AlignButtonGroup } from '../controls';
import { TbAlignLeft, TbAlignCenter, TbAlignRight, TbLayoutAlignTop, TbLayoutAlignMiddle, TbLayoutAlignBottom } from 'react-icons/tb';
import { toast } from '../../Toast/toast';
import api from '../../../utils/api';
import { parseIntOrNull } from '../../../utils/input';
import { DirectionButtons } from './shared';
import { BAR_DIRECTIONS, GAUGE_DIRECTIONS } from './visualTypes';
import { TableGridPart, TableRowsPart, TableTotalsPart, TablePaginationPart, TableColumnSizingPart, TableFreezePart } from './tableParts';

function LineFields({ cfg, updateConfig, inputStyle }) {
  return (
    <>
      <Field label="Smooth">
        <input type="checkbox" checked={cfg.smooth ?? true} onChange={(e) => updateConfig('smooth', e.target.checked)} />
      </Field>
      <Field label="Show area">
        <input type="checkbox" checked={cfg.showArea || false} onChange={(e) => updateConfig('showArea', e.target.checked)} />
      </Field>
      <Field label="Point shape">
        <select value={cfg.lineSymbol ?? 'circle'} onChange={(e) => updateConfig('lineSymbol', e.target.value)}
          style={{ ...inputStyle, marginBottom: 0 }}>
          <option value="circle">● Circle</option>
          <option value="emptyCircle">○ Empty circle</option>
          <option value="rect">■ Square</option>
          <option value="roundRect">▢ Rounded square</option>
          <option value="triangle">▲ Triangle</option>
          <option value="diamond">◆ Diamond</option>
          <option value="pin">📍 Pin</option>
          <option value="arrow">➤ Arrow</option>
          <option value="none">— Hide</option>
        </select>
      </Field>
      {(cfg.lineSymbol ?? 'circle') !== 'none' && (
        <Field label="Point size" vertical>
          <RangeInput min={2} max={20} value={cfg.lineSymbolSize ?? 6}
            onChange={(e) => updateConfig('lineSymbolSize', parseIntOrNull(e.target.value))} suffix="px" />
        </Field>
      )}
    </>
  );
}

// Stored as `hideZeros`; the box reads the positive way and stays checked
// by default, exactly as zeros were shown by default before.
function ShowZeros({ cfg, updateConfig }) {
  return (
    <Field label="Show zero values">
      <input type="checkbox" checked={!(cfg.hideZeros ?? false)}
        onChange={(e) => updateConfig('hideZeros', !e.target.checked)} />
    </Field>
  );
}

export default function VisualSection({ ctx }) {
  const { widget, binding, updateConfig, inputStyle, sections, title, table, pivot } = ctx;
  const type = widget.type;
  const cfg = widget.config || {};
  let body = null;

  if (type === 'bar') {
    body = (
      <>
        <Field label="Direction">
          <DirectionButtons value={cfg.barDirection || 'vertical'} options={BAR_DIRECTIONS} onChange={(v) => updateConfig('barDirection', v)} />
        </Field>
        <ShowZeros cfg={cfg} updateConfig={updateConfig} />
      </>
    );
  } else if (type === 'line') {
    body = (
      <>
        <ShowZeros cfg={cfg} updateConfig={updateConfig} />
        <LineFields cfg={cfg} updateConfig={updateConfig} inputStyle={inputStyle} />
      </>
    );
  } else if (type === 'combo') {
    body = (
      <>
        <Field label="Direction">
          <DirectionButtons value={cfg.barDirection || 'vertical'} options={BAR_DIRECTIONS} onChange={(v) => updateConfig('barDirection', v)} />
        </Field>
        <ShowZeros cfg={cfg} updateConfig={updateConfig} />
        {/* Options for a line that is not drawn are noise: only once a
            measure sits in the line zone. */}
        {(binding.comboLineMeasures?.length > 0) && (
          <SubSection label="Line">
            <LineFields cfg={cfg} updateConfig={updateConfig} inputStyle={inputStyle} />
          </SubSection>
        )}
      </>
    );
  } else if (type === 'pie') {
    body = (
      <Field label="Donut">
        <input type="checkbox" checked={cfg.donut || false} onChange={(e) => updateConfig('donut', e.target.checked)} />
      </Field>
    );
  } else if (type === 'scatter') {
    body = (
      <Field label="Point size" vertical>
        <RangeInput min={2} max={30} value={cfg.symbolSize ?? 10}
          onChange={(e) => updateConfig('symbolSize', parseIntOrNull(e.target.value))} suffix="px" />
      </Field>
    );
  } else if (type === 'treemap') {
    const on = cfg.showItemBorder ?? true;
    body = (
      <>
        <Field label="Show borders">
          <input type="checkbox" checked={on} onChange={(e) => updateConfig('showItemBorder', e.target.checked)} />
        </Field>
        {on && (
          <>
            <Field label="Border color">
              <ColorInput value={cfg.itemBorderColor || '#ffffff'} onChange={(v) => updateConfig('itemBorderColor', v)} allowTransparent={false} />
            </Field>
            <Field label="Border width" vertical>
              <RangeInput min={0} max={8} value={cfg.itemBorderWidth ?? 1}
                onChange={(e) => updateConfig('itemBorderWidth', parseIntOrNull(e.target.value))} suffix="px" />
            </Field>
          </>
        )}
      </>
    );
  } else if (type === 'table') {
    body = (
      <>
        {table.colSelect}
        <TableRowsPart t={table} />
        <TableTotalsPart t={table} />
        <TableGridPart t={table} />
        <TablePaginationPart t={table} />
        <TableColumnSizingPart t={table} />
        <TableFreezePart t={table} />
      </>
    );
  } else if (type === 'pivotTable') {
    const pc = cfg.pivotConfig || {};
    const setGlobal = (key, value) => updateConfig('pivotConfig', { ...pc, [key]: value });
    body = (
      <>
        {table.colSelect}
        <SubSection label="Totals">
          <Field label="Row subtotals">
            <input type="checkbox" checked={pc.showRowSubTotals ?? true} onChange={(e) => setGlobal('showRowSubTotals', e.target.checked)} />
          </Field>
          <Field label="Grand total row">
            <input type="checkbox" checked={pc.showGrandTotalRow ?? true} onChange={(e) => setGlobal('showGrandTotalRow', e.target.checked)} />
          </Field>
          <Field label="Grand total column">
            <input type="checkbox" checked={pc.showGrandTotalCol ?? true} onChange={(e) => setGlobal('showGrandTotalCol', e.target.checked)} />
          </Field>
        </SubSection>
        <SubSection label="Aggregation">
          {pivot.measureSelect}
          <Field label="Aggregation">
            <select value={pivot.getVal('aggregation', 'sum')} onChange={(e) => pivot.setVal('aggregation', e.target.value)}
              style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Count</option>
              <option value="min">Min</option>
              <option value="max">Max</option>
            </select>
          </Field>
        </SubSection>
        <TableRowsPart t={table} />
        <TableGridPart t={table} />
        <TablePaginationPart t={table} />
        <TableColumnSizingPart t={table} />
        <TableFreezePart t={table} />
      </>
    );
  } else if (type === 'scorecard') {
    body = (
      <>
        <Field label="Label">
          {/* Persisted on config: `data.label` was stripped on save and
              overwritten by every refetch. Empty falls back to the
              measure's own label. */}
          <input type="text" value={cfg.label ?? ''} placeholder={widget.data?.label || ''}
            onChange={(e) => updateConfig('label', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
        </Field>
        <Field label="Label position">
          <select value={cfg.labelPosition || 'above'} onChange={(e) => updateConfig('labelPosition', e.target.value)}
            style={{ ...inputStyle, marginBottom: 0 }}>
            <option value="above">Above</option>
            <option value="below">Below</option>
          </select>
        </Field>
      </>
    );
  } else if (type === 'gauge') {
    const column = cfg.subType === 'column';
    body = (
      <>
        {column && (
          <Field label="Direction">
            <DirectionButtons value={cfg.gaugeDirection || 'up'} options={GAUGE_DIRECTIONS} onChange={(v) => updateConfig('gaugeDirection', v)} />
          </Field>
        )}
        <Field label="Min value">
          <DecimalInput value={cfg.gaugeMin ?? 0} onChange={(v) => updateConfig('gaugeMin', v === undefined ? 0 : v)} style={{ ...inputStyle, width: 80 }} />
        </Field>
        {!binding.gaugeMaxMeasure && (
          <Field label="Max value">
            <DecimalInput value={cfg.gaugeMax ?? 100} onChange={(v) => updateConfig('gaugeMax', v === undefined ? 100 : v)} style={{ ...inputStyle, width: 80 }} />
          </Field>
        )}
        {!binding.gaugeThresholdMeasure && (
          <Field label="Threshold value">
            <DecimalInput value={cfg.gaugeThresholdValue ?? undefined} onChange={(v) => updateConfig('gaugeThresholdValue', v)} placeholder="None" style={{ ...inputStyle, width: 80 }} />
          </Field>
        )}
        <Field label="Thickness" vertical>
          <RangeInput min={column ? 10 : 4} max={column ? 120 : 60} value={cfg.gaugeArcWidth ?? (column ? 40 : 18)}
            onChange={(e) => updateConfig('gaugeArcWidth', parseIntOrNull(e.target.value))} suffix="px" />
        </Field>
        {!column && (
          <Field label="Arc opening" vertical>
            <RangeInput min={90} max={360} step={10} value={cfg.gaugeArcSpan ?? 240}
              onChange={(e) => updateConfig('gaugeArcSpan', parseIntOrNull(e.target.value))} suffix="°" />
          </Field>
        )}
        {column && (
          <Field label="Rounded ends">
            <input type="checkbox" checked={cfg.gaugeArcRounded ?? false} onChange={(e) => updateConfig('gaugeArcRounded', e.target.checked)} />
          </Field>
        )}
      </>
    );
  } else if (type === 'filter') {
    const effStyle = cfg.slicerStyle || (widget.data?._isDate ? 'dateRange' : 'list');
    const isDateRange = effStyle === 'dateRange' || effStyle === 'dateBetween';
    const isDateCalendar = effStyle === 'dateCalendar';
    const isDateAny = isDateRange || effStyle === 'dateRelative' || isDateCalendar;
    const isListLike = !isDateAny && effStyle !== 'range';
    body = (
      <>
        <Field label="Style">
          <select value={effStyle} onChange={(e) => updateConfig('slicerStyle', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
            <option value="list">List</option>
            <option value="dropdown">Dropdown</option>
            <option value="buttons">Buttons</option>
            <option value="range">Range</option>
            {widget.data?._isDate && (
              <>
                <option value="dateRange">📆 Date range</option>
                <option value="dateRelative">📆 Relative date</option>
                <option value="dateCalendar">📆 Calendar</option>
              </>
            )}
          </select>
        </Field>
        {isDateRange && (
          <Field label="Layout">
            <select value={cfg.dateLayout || 'vertical'} onChange={(e) => updateConfig('dateLayout', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="vertical">Vertical</option>
              <option value="horizontal">Horizontal</option>
            </select>
          </Field>
        )}
        {isDateCalendar && (
          <Field label="Selection">
            <select value={cfg.dateCalendarMode || ((cfg.multiSelect ?? true) ? 'multi' : 'single')}
              onChange={(e) => updateConfig('dateCalendarMode', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="single">Single</option>
              <option value="multi">Multi</option>
              <option value="between">Between</option>
            </select>
          </Field>
        )}
        {isListLike && (
          <>
            <Field label="Multi-select">
              <input type="checkbox" checked={cfg.multiSelect ?? true} onChange={(e) => updateConfig('multiSelect', e.target.checked)} />
            </Field>
            {(effStyle === 'list' || effStyle === 'dropdown') && (
              <Field label="Show search">
                <input type="checkbox" checked={cfg.showSearch ?? true} onChange={(e) => updateConfig('showSearch', e.target.checked)} />
              </Field>
            )}
            {effStyle === 'list' && (
              <Field label="Show select all">
                <input type="checkbox" checked={cfg.showSelectAll ?? true} onChange={(e) => updateConfig('showSelectAll', e.target.checked)} />
              </Field>
            )}
            {(effStyle === 'list' || effStyle === 'buttons') && (
              <Field label="Orientation">
                <select value={cfg.orientation || 'vertical'} onChange={(e) => updateConfig('orientation', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
                  <option value="vertical">Vertical</option>
                  <option value="horizontal">Horizontal</option>
                </select>
              </Field>
            )}
          </>
        )}
      </>
    );
  } else if (type === 'text') {
    // The text itself is edited on the canvas (double-click); the panel
    // holds the layout. Values are flex keywords, applied as-is.
    body = (
      <>
        <Field label="Padding">
          <input type="number" min={0} max={64} value={cfg.padding ?? ''} placeholder="8"
            onChange={(e) => updateConfig('padding', parseIntOrNull(e.target.value))} style={{ ...inputStyle, width: 60, marginBottom: 0 }} />
        </Field>
        <Field label="Horizontal">
          <AlignButtonGroup value={cfg.textAlign || 'center'} onChange={(v) => updateConfig('textAlign', v)}
            options={[
              { v: 'flex-start', Icon: TbAlignLeft, title: 'Align left' },
              { v: 'center', Icon: TbAlignCenter, title: 'Align center' },
              { v: 'flex-end', Icon: TbAlignRight, title: 'Align right' },
            ]} />
        </Field>
        <Field label="Vertical">
          <AlignButtonGroup value={cfg.verticalAlign || 'center'} onChange={(v) => updateConfig('verticalAlign', v)}
            options={[
              { v: 'flex-start', Icon: TbLayoutAlignTop, title: 'Align top' },
              { v: 'center', Icon: TbLayoutAlignMiddle, title: 'Align middle' },
              { v: 'flex-end', Icon: TbLayoutAlignBottom, title: 'Align bottom' },
            ]} />
        </Field>
      </>
    );
  } else if (type === 'shape') {
    if (cfg.shape === 'line') {
      body = (
        <>
          <Field label="Thickness" vertical>
            <RangeInput min={1} max={20} value={cfg.lineThickness ?? 2}
              onChange={(e) => updateConfig('lineThickness', parseIntOrNull(e.target.value))} suffix="px" />
          </Field>
          {/* Applied by ShapeWidget as a CSS rotate on the inner line, so a
              diagonal is drawn without changing the widget's box. */}
          <Field label="Rotation" vertical>
            <RangeInput min={0} max={360} value={cfg.lineRotation ?? 0}
              onChange={(e) => updateConfig('lineRotation', parseIntOrNull(e.target.value))} suffix="°" />
          </Field>
        </>
      );
    } else if (cfg.shape === 'arrow') {
      body = (
        <>
          <Field label="Direction">
            <select value={cfg.arrowDirection || 'right'} onChange={(e) => updateConfig('arrowDirection', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="right">Right →</option>
              <option value="down">Down ↓</option>
              <option value="left">Left ←</option>
              <option value="up">Up ↑</option>
            </select>
          </Field>
          <Field label="Stroke width">
            <input type="number" min={0} max={20} value={cfg.shapeStrokeWidth ?? ''} placeholder="2"
              onChange={(e) => updateConfig('shapeStrokeWidth', parseIntOrNull(e.target.value))} style={{ ...inputStyle, marginBottom: 0 }} />
          </Field>
          <Field label="Opacity (%)">
            <input type="number" min={0} max={100} value={cfg.shapeOpacity ?? ''} placeholder="100"
              onChange={(e) => updateConfig('shapeOpacity', parseIntOrNull(e.target.value))} style={{ ...inputStyle, marginBottom: 0 }} />
          </Field>
        </>
      );
    }
  } else if (type === 'image') {
    body = (
      <>
        <Field label="URL">
          <input type="text" value={cfg.url || ''} placeholder="https://…"
            onChange={(e) => updateConfig('url', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
        </Field>
        {/* Upload is OSS-only: cloud builds strip this block at build time
            and their users paste a URL from their own host. */}
        {!import.meta.env.VITE_OPENREPORT_CLOUD && (
          <Field label="Upload">
            <input type="file" accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append('image', file);
                try {
                  const res = await api.post('/images', form, { headers: { 'Content-Type': 'multipart/form-data' } });
                  if (res.data?.url) updateConfig('url', res.data.url);
                } catch (err) {
                  toast(err.response?.data?.error || 'Upload failed');
                } finally {
                  e.target.value = '';
                }
              }}
              style={{ ...inputStyle, marginBottom: 0, padding: 2 }} />
          </Field>
        )}
        <Field label="Fit">
          <select value={cfg.fit || 'contain'} onChange={(e) => updateConfig('fit', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
            <option value="contain">Contain (no crop)</option>
            <option value="cover">Cover (crop to fill)</option>
            <option value="fill">Fill (stretch)</option>
            <option value="none">None (original size)</option>
          </select>
        </Field>
        <Field label="Alt text">
          <input type="text" value={cfg.alt || ''} placeholder="Image description"
            onChange={(e) => updateConfig('alt', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
        </Field>
      </>
    );
  } else if (type === 'customVisual') {
    // Generated from the manifest's configSchema.
    const cs = cfg.manifest?.configSchema;
    if (Array.isArray(cs) && cs.length > 0) {
      body = cs.map((opt) => {
        if (!opt || typeof opt !== 'object' || !opt.key) return null;
        const value = cfg[opt.key] ?? opt.default;
        const label = opt.label || opt.key;
        if (opt.type === 'boolean') {
          return (
            <Field key={opt.key} label={label}>
              <input type="checkbox" checked={value === true} onChange={(e) => updateConfig(opt.key, e.target.checked)} />
            </Field>
          );
        }
        if (opt.type === 'number') {
          return (
            <Field key={opt.key} label={label}>
              <input type="number" value={value ?? ''} min={opt.min} max={opt.max} step={opt.step}
                onChange={(e) => updateConfig(opt.key, e.target.value === '' ? undefined : Number(e.target.value))}
                style={{ ...inputStyle, width: 80, marginBottom: 0 }} />
            </Field>
          );
        }
        if (opt.type === 'color') {
          return (
            <Field key={opt.key} label={label}>
              <ColorInput value={value || opt.default || '#7c3aed'} onChange={(v) => updateConfig(opt.key, v)} />
            </Field>
          );
        }
        if (opt.type === 'string') {
          return (
            <Field key={opt.key} label={label}>
              <input type="text" value={value || ''} onChange={(e) => updateConfig(opt.key, e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
            </Field>
          );
        }
        if (opt.type === 'select') {
          const opts = Array.isArray(opt.options) ? opt.options : [];
          return (
            <Field key={opt.key} label={label}>
              <select value={value ?? (opts[0]?.value ?? '')} onChange={(e) => updateConfig(opt.key, e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
              </select>
            </Field>
          );
        }
        return null;
      });
    }
  }

  if (!body) return null;
  return (
    <Section id="visual" title={title} sectionState={sections} defaultOpen>
      {body}
    </Section>
  );
}
