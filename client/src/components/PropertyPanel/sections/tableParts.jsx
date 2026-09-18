// The table / pivot table settings, as parts the Visual, Colors and Labels
// sections compose. All of them write `config.tableConfig` through the
// scope-aware helpers of tableCtx.jsx (`t`).
import { useState } from 'react';
import { SubSection, Field, RangeInput, ColorInput } from '../controls';
import { parseIntOrNull, parseFloatOrNull } from '../../../utils/input';
import { FontFields } from './shared';

const alignRow = { display: 'flex', gap: 2 };
const hint = { fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' };
const removeBtn = { fontSize: 10, color: 'var(--state-danger)', background: 'transparent', border: '1px solid var(--state-danger-border)', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', marginTop: 4 };
const addRow = { display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 };
const addBtn = { fontSize: 10, padding: '3px 6px', border: '1px solid var(--border-default)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', color: 'var(--text-secondary)' };
const levelLabel = { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 };
const levelRow = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 };
const relative = { position: 'relative' };
const toggleBtn = {
  width: 28, height: 24, border: '1px solid var(--border-default)', borderRadius: 3,
  cursor: 'pointer', fontSize: 11, fontWeight: 600,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const iconLevelStyle = { padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' };
const presetDropdown = {
  position: 'absolute', top: 30, left: 0, zIndex: 20,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  padding: 6, display: 'flex', flexWrap: 'wrap', gap: 2, width: 170,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
};

function AlignButtons({ value, options, onChange }) {
  return (
    <div style={alignRow}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          style={{ ...toggleBtn, background: value === v ? 'var(--accent-primary)' : 'var(--bg-panel)', color: value === v ? 'var(--text-inverse)' : 'var(--text-secondary)' }}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ─── Labels ───

export function TableHeadersPart({ t }) {
  const { get, update, updateGlobal, tc, selectedCol, inputStyle } = t;
  return (
    <SubSection label="Headers">
      <Field label="Show headers">
        <input type="checkbox" checked={get('header', 'show', true)} onChange={(e) => update('header.show', e.target.checked)} />
      </Field>
      <FontFields inputStyle={inputStyle}
        size={{ value: get('header', 'fontSize', 13), min: 8, max: 24, onChange: (v) => update('header.fontSize', v) }}
        color={{ value: get('header', 'fontColor', '#334155'), onChange: (v) => update('header.fontColor', v) }}
        family={{ value: get('header', 'fontFamily', null), onChange: (v) => update('header.fontFamily', v) }} />
      <Field label="Bold">
        <input type="checkbox" checked={get('header', 'fontBold', true)} onChange={(e) => update('header.fontBold', e.target.checked)} />
      </Field>
      <Field label="Italic">
        <input type="checkbox" checked={get('header', 'fontItalic', false)} onChange={(e) => update('header.fontItalic', e.target.checked)} />
      </Field>
      <Field label="Background">
        <ColorInput value={get('header', 'bgColor', '#f8fafc')} onChange={(v) => update('header.bgColor', v)} />
      </Field>
      <Field label="Alignment">
        <AlignButtons value={get('header', 'alignment', 'left')} options={[['left', 'L'], ['center', 'C'], ['right', 'R']]} onChange={(v) => update('header.alignment', v)} />
      </Field>
      <Field label="Word wrap">
        <input type="checkbox" checked={get('header', 'wordWrap', true)} onChange={(e) => update('header.wordWrap', e.target.checked)} />
      </Field>
      {selectedCol && (
        <Field label="Rename">
          <input type="text" value={tc.columns?.[selectedCol]?.displayName || ''} placeholder={selectedCol}
            onChange={(e) => updateGlobal(`columns.${selectedCol}.displayName`, e.target.value || undefined)}
            style={{ ...inputStyle, marginBottom: 0 }} />
        </Field>
      )}
    </SubSection>
  );
}

export function TableCellsPart({ t }) {
  const { get, update, inputStyle } = t;
  return (
    <SubSection label="Cells">
      <FontFields inputStyle={inputStyle}
        size={{ value: get('values', 'fontSize', 13), min: 8, max: 24, onChange: (v) => update('values.fontSize', v) }}
        color={{ value: get('values', 'fontColor', '#475569'), onChange: (v) => update('values.fontColor', v) }}
        family={{ value: get('values', 'fontFamily', null), onChange: (v) => update('values.fontFamily', v) }} />
      <Field label="Bold">
        <input type="checkbox" checked={get('values', 'fontBold', false)} onChange={(e) => update('values.fontBold', e.target.checked)} />
      </Field>
      <Field label="Italic">
        <input type="checkbox" checked={get('values', 'fontItalic', false)} onChange={(e) => update('values.fontItalic', e.target.checked)} />
      </Field>
      <Field label="Background">
        <ColorInput value={get('values', 'bgColor', '#ffffff')} onChange={(v) => update('values.bgColor', v)} />
      </Field>
      <Field label="Alignment">
        <AlignButtons value={get('values', 'alignment', 'auto')} options={[['auto', 'Auto'], ['left', 'L'], ['center', 'C'], ['right', 'R']]} onChange={(v) => update('values.alignment', v)} />
      </Field>
      <Field label="Word wrap">
        <input type="checkbox" checked={get('values', 'wordWrap', true)} onChange={(e) => update('values.wordWrap', e.target.checked)} />
      </Field>
    </SubSection>
  );
}

// Decimals for the cells (per column or global). The abbreviation select is
// rendered by the caller so a pivot can show its per-measure one instead.
export function TableDecimalsField({ t }) {
  const { get, update, inputStyle } = t;
  return (
    <Field label="Decimals">
      <input type="number" min={0} max={6}
        value={get('values', 'numberFormat', {}).decimals ?? ''}
        placeholder="Auto"
        onChange={(e) => update('values.numberFormat.decimals', e.target.value ? parseIntOrNull(e.target.value) : null)}
        style={{ ...inputStyle, width: 55, marginBottom: 0 }} />
    </Field>
  );
}

// ─── Visual (structure) ───

function LinesPart({ label, keyBase, t }) {
  const { getGlobal, updateGlobal } = t;
  const on = getGlobal(`grid.${keyBase}Lines`, keyBase === 'horizontal');
  return (
    <SubSection label={label}>
      <Field label="Show">
        <input type="checkbox" checked={on} onChange={(e) => updateGlobal(`grid.${keyBase}Lines`, e.target.checked)} />
      </Field>
      {on && (
        <>
          <Field label="Color">
            <ColorInput value={getGlobal(`grid.${keyBase}Color`, '#e2e8f0')} onChange={(v) => updateGlobal(`grid.${keyBase}Color`, v)} />
          </Field>
          <Field label="Width" vertical>
            <RangeInput min={0} max={3} step={0.5} value={getGlobal(`grid.${keyBase}Width`, 1)}
              onChange={(e) => updateGlobal(`grid.${keyBase}Width`, parseFloatOrNull(e.target.value))} />
          </Field>
        </>
      )}
    </SubSection>
  );
}

export function TableGridPart({ t }) {
  const { getGlobal, updateGlobal } = t;
  const border = getGlobal('grid.outerBorder', false);
  return (
    <>
      <LinesPart label="Horizontal lines" keyBase="horizontal" t={t} />
      <LinesPart label="Vertical lines" keyBase="vertical" t={t} />
      <SubSection label="Border">
        <Field label="Show border">
          <input type="checkbox" checked={border} onChange={(e) => updateGlobal('grid.outerBorder', e.target.checked)} />
        </Field>
        {border && (
          <>
            <Field label="Border color">
              <ColorInput value={getGlobal('grid.outerBorderColor', '#e2e8f0')} onChange={(v) => updateGlobal('grid.outerBorderColor', v)} />
            </Field>
            <Field label="Border width" vertical>
              <RangeInput min={0} max={3} step={0.5} value={getGlobal('grid.outerBorderWidth', 1)}
                onChange={(e) => updateGlobal('grid.outerBorderWidth', parseFloatOrNull(e.target.value))} />
            </Field>
          </>
        )}
      </SubSection>
      <Field label="Cell padding" vertical>
        <RangeInput min={2} max={16} value={getGlobal('grid.cellPadding', 8)}
          onChange={(e) => updateGlobal('grid.cellPadding', parseIntOrNull(e.target.value))} />
      </Field>
    </>
  );
}

export function TableRowsPart({ t }) {
  const { getGlobal, updateGlobal, inputStyle } = t;
  const striped = getGlobal('rows.striped', true);
  const hover = getGlobal('rows.hoverHighlight', true);
  return (
    <SubSection label="Rows">
      <Field label="Row height">
        <select value={getGlobal('rows.height', 'normal')} onChange={(e) => updateGlobal('rows.height', e.target.value)}
          style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
          <option value="compact">Compact</option>
          <option value="normal">Normal</option>
          <option value="large">Large</option>
        </select>
      </Field>
      <Field label="Striped rows">
        <input type="checkbox" checked={striped} onChange={(e) => updateGlobal('rows.striped', e.target.checked)} />
      </Field>
      {striped ? (
        <>
          <Field label="Stripe color 1">
            <ColorInput value={getGlobal('rows.stripeColor1', '#ffffff')} onChange={(v) => updateGlobal('rows.stripeColor1', v)} />
          </Field>
          <Field label="Stripe color 2">
            <ColorInput value={getGlobal('rows.stripeColor2', '#f8fafc')} onChange={(v) => updateGlobal('rows.stripeColor2', v)} />
          </Field>
        </>
      ) : (
        // Its own key, so toggling stripes does not shuffle the two settings
        // into each other.
        <Field label="Background">
          <ColorInput value={getGlobal('rows.bgColor', getGlobal('rows.stripeColor1', '#ffffff'))} onChange={(v) => updateGlobal('rows.bgColor', v)} />
        </Field>
      )}
      <Field label="Hover highlight">
        <input type="checkbox" checked={hover} onChange={(e) => updateGlobal('rows.hoverHighlight', e.target.checked)} />
      </Field>
      {hover && (
        <Field label="Hover color">
          <ColorInput value={getGlobal('rows.hoverColor', '#eef2ff')} onChange={(v) => updateGlobal('rows.hoverColor', v)} />
        </Field>
      )}
    </SubSection>
  );
}

export function TableTotalsPart({ t }) {
  const { getGlobal, updateGlobal, tc, selectedCol, inputStyle } = t;
  const on = getGlobal('totals.enabled', false);
  return (
    <SubSection label="Totals">
      <Field label="Show totals">
        <input type="checkbox" checked={on} onChange={(e) => updateGlobal('totals.enabled', e.target.checked)} />
      </Field>
      {on && (
        <>
          <Field label="Default function">
            <select value={getGlobal('totals.defaultFn', 'sum')} onChange={(e) => updateGlobal('totals.defaultFn', e.target.value)}
              style={{ ...inputStyle, width: 80, marginBottom: 0 }}>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Count</option>
              <option value="min">Min</option>
              <option value="max">Max</option>
            </select>
          </Field>
          {selectedCol && (
            <Field label="Column function">
              <select value={tc.columns?.[selectedCol]?.totals?.fn || ''}
                onChange={(e) => updateGlobal(`columns.${selectedCol}.totals.fn`, e.target.value || undefined)}
                style={{ ...inputStyle, width: 80, marginBottom: 0 }}>
                <option value="">Default</option>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="count">Count</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
              </select>
            </Field>
          )}
          <Field label="Bold">
            <input type="checkbox" checked={getGlobal('totals.fontBold', true)} onChange={(e) => updateGlobal('totals.fontBold', e.target.checked)} />
          </Field>
          <Field label="Background">
            <ColorInput value={getGlobal('totals.bgColor', '#f1f5f9')} onChange={(v) => updateGlobal('totals.bgColor', v)} />
          </Field>
          <Field label="Font color">
            <ColorInput value={getGlobal('totals.fontColor', '#1e293b')} onChange={(v) => updateGlobal('totals.fontColor', v)} />
          </Field>
        </>
      )}
    </SubSection>
  );
}

export function TablePaginationPart({ t }) {
  const { getGlobal, updateGlobal, inputStyle } = t;
  return (
    <SubSection label="Pagination">
      <Field label="Mode">
        <select value={getGlobal('pagination.mode', 'infinite')} onChange={(e) => updateGlobal('pagination.mode', e.target.value)}
          style={{ ...inputStyle, width: 100, marginBottom: 0 }}>
          <option value="infinite">Infinite scroll</option>
          <option value="paginated">Pages</option>
        </select>
      </Field>
      {getGlobal('pagination.mode', 'infinite') === 'paginated' && (
        <Field label="Rows per page">
          <input type="number" min={5} max={500} value={getGlobal('pagination.rowsPerPage', 50)}
            onChange={(e) => updateGlobal('pagination.rowsPerPage', parseIntOrNull(e.target.value))}
            style={{ ...inputStyle, width: 60, marginBottom: 0 }} />
        </Field>
      )}
    </SubSection>
  );
}

export function TableColumnSizingPart({ t }) {
  const { getGlobal, updateGlobal, tc, selectedCol, inputStyle } = t;
  return (
    <SubSection label="Column width">
      <Field label="Mode">
        <select value={getGlobal('columnWidthMode', 'auto')} onChange={(e) => updateGlobal('columnWidthMode', e.target.value)}
          style={{ ...inputStyle, width: 80, marginBottom: 0 }}>
          <option value="auto">Auto</option>
          <option value="fixed">Fixed</option>
        </select>
      </Field>
      {selectedCol && getGlobal('columnWidthMode', 'auto') === 'fixed' && (
        <Field label="Width (px)">
          <input type="number" min={40} max={600} value={tc.columns?.[selectedCol]?.width || ''} placeholder="Auto"
            onChange={(e) => updateGlobal(`columns.${selectedCol}.width`, e.target.value ? parseIntOrNull(e.target.value) : undefined)}
            style={{ ...inputStyle, width: 65, marginBottom: 0 }} />
        </Field>
      )}
      {!selectedCol && getGlobal('columnWidthMode', 'auto') === 'fixed' && (
        <div style={hint}>Pick a column to set its width</div>
      )}
    </SubSection>
  );
}

export function TableFreezePart({ t }) {
  const { getGlobal, updateGlobal } = t;
  return (
    <SubSection label="Freeze">
      <Field label="Sticky header">
        <input type="checkbox" checked={getGlobal('freeze.stickyHeader', true)} onChange={(e) => updateGlobal('freeze.stickyHeader', e.target.checked)} />
      </Field>
      <Field label="Freeze first column">
        <input type="checkbox" checked={getGlobal('freeze.freezeFirstColumn', false)} onChange={(e) => updateGlobal('freeze.freezeFirstColumn', e.target.checked)} />
      </Field>
    </SubSection>
  );
}

// ─── Colors ───

export function TableConditionalPart({ t }) {
  const { tc, selectedCol, updateGlobal, inputStyle } = t;
  return (
    <SubSection label="Conditional format">
      {selectedCol ? (
        <>
          <Field label="Hide value">
            <input type="checkbox" checked={tc.columns?.[selectedCol]?.hideValue ?? false}
              onChange={(e) => updateGlobal(`columns.${selectedCol}.hideValue`, e.target.checked)} />
          </Field>
          <ConditionalFormatEditor
            rules={tc.columns?.[selectedCol]?.conditionalFormatting || []}
            onChange={(rules) => updateGlobal(`columns.${selectedCol}.conditionalFormatting`, rules)}
            inputStyle={inputStyle}
          />
        </>
      ) : (
        <div style={hint}>Pick a column above</div>
      )}
    </SubSection>
  );
}

const RULE_LABELS = { dataBar: 'Data bar', colorScale: 'Color scale', textColor: 'Text color', icon: 'Icon' };

function ConditionalFormatEditor({ rules, onChange, inputStyle }) {
  const addRule = (type) => {
    const defaults = {
      dataBar: { type: 'dataBar', dataBarColor: '#7c3aed', dataBarBgColor: '#f5f3ff' },
      colorScale: { type: 'colorScale', minColor: '#dcfce7', maxColor: '#dc2626' },
      textColor: { type: 'textColor', minColor: '#dc2626', maxColor: '#16a34a', minValue: null, maxValue: null },
      icon: { type: 'icon', lowIcon: '↓', lowColor: '#dc2626', lowValue: null, midIcon: '→', midColor: '#f59e0b', midValue: null, highIcon: '↑', highColor: '#16a34a', highValue: null },
    };
    onChange([...rules, defaults[type]]);
  };
  const removeRule = (idx) => onChange(rules.filter((_, i) => i !== idx));
  const updateRule = (idx, key, value) => onChange(rules.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  const numberField = (label, i, key) => (
    <Field label={label}>
      <input type="number" value={rules[i][key] ?? ''} placeholder="Auto"
        onChange={(e) => updateRule(i, key, e.target.value !== '' ? parseFloatOrNull(e.target.value) : null)}
        style={{ ...inputStyle, width: 65, marginBottom: 0 }} />
    </Field>
  );
  const colorField = (label, i, key, fallback) => (
    <Field label={label}>
      <ColorInput value={rules[i][key] || fallback} onChange={(v) => updateRule(i, key, v)} />
    </Field>
  );
  return (
    <div>
      {rules.map((rule, i) => (
        <div key={i} style={iconLevelStyle}>
          <div style={levelLabel}>{RULE_LABELS[rule.type] || rule.type} #{i + 1}</div>
          {rule.type === 'dataBar' && colorField('Bar color', i, 'dataBarColor', '#7c3aed')}
          {rule.type === 'colorScale' && (
            <>
              {colorField('Min color', i, 'minColor', '#dcfce7')}
              {numberField('Min value', i, 'minValue')}
              {colorField('Max color', i, 'maxColor', '#dc2626')}
              {numberField('Max value', i, 'maxValue')}
            </>
          )}
          {rule.type === 'textColor' && (
            <>
              {colorField('Min color', i, 'minColor', '#dc2626')}
              {numberField('Min value', i, 'minValue')}
              {colorField('Max color', i, 'maxColor', '#16a34a')}
              {numberField('Max value', i, 'maxValue')}
            </>
          )}
          {rule.type === 'icon' && (
            <>
              <IconLevelEditor label="Low ≤" icon={rule.lowIcon ?? '↓'} color={rule.lowColor ?? '#dc2626'} value={rule.lowValue} valuePlaceholder="Auto (min)"
                onIconChange={(v) => updateRule(i, 'lowIcon', v)} onColorChange={(v) => updateRule(i, 'lowColor', v)} onValueChange={(v) => updateRule(i, 'lowValue', v)} inputStyle={inputStyle} />
              <IconLevelEditor label="Mid ≤" icon={rule.midIcon ?? '→'} color={rule.midColor ?? '#f59e0b'} value={rule.midValue} valuePlaceholder="Auto (avg)"
                onIconChange={(v) => updateRule(i, 'midIcon', v)} onColorChange={(v) => updateRule(i, 'midColor', v)} onValueChange={(v) => updateRule(i, 'midValue', v)} inputStyle={inputStyle} />
              <IconLevelEditor label="High >" icon={rule.highIcon ?? '↑'} color={rule.highColor ?? '#16a34a'} value={rule.highValue} valuePlaceholder="Auto (max)"
                onIconChange={(v) => updateRule(i, 'highIcon', v)} onColorChange={(v) => updateRule(i, 'highColor', v)} onValueChange={(v) => updateRule(i, 'highValue', v)} inputStyle={inputStyle} />
            </>
          )}
          <button type="button" onClick={() => removeRule(i)} style={removeBtn}>Remove</button>
        </div>
      ))}
      <div style={addRow}>
        {Object.entries(RULE_LABELS).map(([type, label]) => (
          <button key={type} type="button" onClick={() => addRule(type)} style={addBtn}>+ {label}</button>
        ))}
      </div>
    </div>
  );
}

const ICON_PRESETS = ['↑', '↓', '→', '↗', '↘', '●', '▲', '▼', '★', '✓', '✗', '⚠', '♦', '■', '◆'];

function IconLevelEditor({ label, icon, color, value, valuePlaceholder, onIconChange, onColorChange, onValueChange, inputStyle }) {
  const [showPresets, setShowPresets] = useState(false);
  return (
    <div style={iconLevelStyle}>
      <div style={levelLabel}>{label}</div>
      <div style={levelRow}>
        <div style={relative}>
          <button type="button" onClick={() => setShowPresets(!showPresets)}
            style={{ width: 30, height: 26, border: '1px solid var(--border-default)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', fontSize: 14, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </button>
          {showPresets && (
            <div style={presetDropdown}>
              {ICON_PRESETS.map((ic) => (
                <button key={ic} type="button" onClick={() => { onIconChange(ic); setShowPresets(false); }}
                  style={{ width: 26, height: 26, border: 'none', background: icon === ic ? 'var(--bg-active)' : 'var(--bg-panel)', cursor: 'pointer', fontSize: 14, borderRadius: 3 }}>
                  {ic}
                </button>
              ))}
              <input type="text" value={icon} placeholder="Custom"
                onChange={(e) => onIconChange(e.target.value)}
                style={{ ...inputStyle, width: '100%', marginBottom: 0, marginTop: 4, fontSize: 12, textAlign: 'center' }} />
            </div>
          )}
        </div>
        <ColorInput value={color} onChange={onColorChange} />
        <input type="number" value={value ?? ''} placeholder={valuePlaceholder}
          onChange={(e) => onValueChange(e.target.value !== '' ? parseFloatOrNull(e.target.value) : null)}
          style={{ ...inputStyle, flex: 1, marginBottom: 0, fontSize: 11 }} />
      </div>
    </div>
  );
}
