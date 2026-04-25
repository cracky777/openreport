import { useState } from 'react';
import { setNestedValue } from '../../utils/tableConfigHelpers';

/**
 * Complete table configuration panel with per-column and global settings.
 */
export default function TablePropertySections({ widget, updateConfig, Section, SubSection, Field, RangeInput, ColorInput, inputStyle, sections }) {
  const tc = widget.config?.tableConfig || {};
  const isPivot = widget.type === 'pivotTable';
  const pivotRowDims = widget.data?._rowDims || [];
  const pivotColDims = widget.data?._colDims || [];
  const pivotMeasures = widget.data?._measures || [];
  // For pivot table: show "Rows" (single entry for hierarchy) + col dims + measures
  // For table: show data.columns
  const columns = isPivot
    ? [...(pivotRowDims.length > 0 ? ['Rows'] : []), ...pivotColDims, ...pivotMeasures]
    : (widget.data?.columns || []);
  const [selectedCol, setSelectedCol] = useState(null); // null = global

  const update = (path, value) => {
    const prefix = selectedCol ? `columns.${selectedCol}.` : '';
    updateConfig('tableConfig', setNestedValue(tc, prefix + path, value));
  };

  const updateGlobal = (path, value) => {
    updateConfig('tableConfig', setNestedValue(tc, path, value));
  };

  // Read helpers — resolve per-column then global
  const get = (section, key, defaultVal) => {
    if (selectedCol) {
      const colVal = tc.columns?.[selectedCol]?.[section]?.[key];
      if (colVal !== undefined) return colVal;
    }
    return tc[section]?.[key] ?? defaultVal;
  };

  const getGlobal = (path, defaultVal) => {
    const keys = path.split('.');
    let v = tc;
    for (const k of keys) { v = v?.[k]; if (v === undefined) return defaultVal; }
    return v;
  };

  const colSelect = columns.length > 0 ? (
    <div style={colSelectStyle}>
      <select
        value={selectedCol || ''}
        onChange={(e) => setSelectedCol(e.target.value || null)}
        style={{ ...inputStyle, marginBottom: 0, fontSize: 11 }}
      >
        <option value="">All columns</option>
        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  ) : null;

  return (
    <>

      {/* Column Headers */}
      <Section title="Column Headers" sectionState={sections}>
        {colSelect}
        <Field label="Show headers">
          <input type="checkbox" checked={get('header', 'show', true)}
            onChange={(e) => update('header.show', e.target.checked)} />
        </Field>
        <Field label="Font size">
          <input type="number" min={8} max={24} value={get('header', 'fontSize', 13)}
            onChange={(e) => update('header.fontSize', parseInt(e.target.value) || 13)}
            style={{ ...inputStyle, width: 55, marginBottom: 0 }} />
        </Field>
        <Field label="Font color">
          <ColorInput value={get('header', 'fontColor', '#334155')}
            onChange={(v) => update('header.fontColor', v)} />
        </Field>
        <Field label="Bold">
          <input type="checkbox" checked={get('header', 'fontBold', true)}
            onChange={(e) => update('header.fontBold', e.target.checked)} />
        </Field>
        <Field label="Italic">
          <input type="checkbox" checked={get('header', 'fontItalic', false)}
            onChange={(e) => update('header.fontItalic', e.target.checked)} />
        </Field>
        <Field label="Background">
          <ColorInput value={get('header', 'bgColor', '#f8fafc')}
            onChange={(v) => update('header.bgColor', v)} />
        </Field>
        <Field label="Alignment">
          <div style={{ display: 'flex', gap: 2 }}>
            {[['left', 'L'], ['center', 'C'], ['right', 'R']].map(([v, l]) => (
              <button key={v} onClick={() => update('header.alignment', v)}
                style={{ ...toggleBtn, background: get('header', 'alignment', 'left') === v ? '#7c3aed' : '#fff', color: get('header', 'alignment', 'left') === v ? '#fff' : '#475569' }}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Word wrap">
          <input type="checkbox" checked={get('header', 'wordWrap', false)}
            onChange={(e) => update('header.wordWrap', e.target.checked)} />
        </Field>
        {selectedCol && (
          <Field label="Rename">
            <input type="text" value={tc.columns?.[selectedCol]?.displayName || ''}
              placeholder={selectedCol}
              onChange={(e) => updateGlobal(`columns.${selectedCol}.displayName`, e.target.value || undefined)}
              style={{ ...inputStyle, marginBottom: 0 }} />
          </Field>
        )}
      </Section>

      {/* Values */}
      <Section title="Values" sectionState={sections}>
        {colSelect}
        <Field label="Font size">
          <input type="number" min={8} max={24} value={get('values', 'fontSize', 13)}
            onChange={(e) => update('values.fontSize', parseInt(e.target.value) || 13)}
            style={{ ...inputStyle, width: 55, marginBottom: 0 }} />
        </Field>
        <Field label="Font color">
          <ColorInput value={get('values', 'fontColor', '#475569')}
            onChange={(v) => update('values.fontColor', v)} />
        </Field>
        <Field label="Bold">
          <input type="checkbox" checked={get('values', 'fontBold', false)}
            onChange={(e) => update('values.fontBold', e.target.checked)} />
        </Field>
        <Field label="Italic">
          <input type="checkbox" checked={get('values', 'fontItalic', false)}
            onChange={(e) => update('values.fontItalic', e.target.checked)} />
        </Field>
        <Field label="Background">
          <ColorInput value={get('values', 'bgColor', '#ffffff')}
            onChange={(v) => update('values.bgColor', v)} />
        </Field>
        <Field label="Alignment">
          <div style={{ display: 'flex', gap: 2 }}>
            {[['auto', 'Auto'], ['left', 'L'], ['center', 'C'], ['right', 'R']].map(([v, l]) => (
              <button key={v} onClick={() => update('values.alignment', v)}
                style={{ ...toggleBtn, background: get('values', 'alignment', 'auto') === v ? '#7c3aed' : '#fff', color: get('values', 'alignment', 'auto') === v ? '#fff' : '#475569' }}>
                {l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Word wrap">
          <input type="checkbox" checked={get('values', 'wordWrap', false)}
            onChange={(e) => update('values.wordWrap', e.target.checked)} />
        </Field>
        <SubSection label="Number format">
          <Field label="Abbreviation">
            <select value={get('values', 'numberFormat', {}).abbreviation || 'none'}
              onChange={(e) => update('values.numberFormat.abbreviation', e.target.value)}
              style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
              <option value="none">None</option>
              <option value="auto">Auto</option>
              <option value="K">K</option>
              <option value="M">M</option>
              <option value="B">B</option>
            </select>
          </Field>
          <Field label="Decimals">
            <input type="number" min={0} max={6}
              value={get('values', 'numberFormat', {}).decimals ?? ''}
              placeholder="Auto"
              onChange={(e) => update('values.numberFormat.decimals', e.target.value ? parseInt(e.target.value) : null)}
              style={{ ...inputStyle, width: 55, marginBottom: 0 }} />
          </Field>
        </SubSection>
      </Section>

      {/* Grid & Borders — always global */}
      <Section title="Grid & Borders" sectionState={sections}>
        <SubSection label="Horizontal lines">
          <Field label="Show">
            <input type="checkbox" checked={getGlobal('grid.horizontalLines', true)}
              onChange={(e) => updateGlobal('grid.horizontalLines', e.target.checked)} />
          </Field>
          {getGlobal('grid.horizontalLines', true) && (
            <>
              <Field label="Color">
                <ColorInput value={getGlobal('grid.horizontalColor', '#e2e8f0')}
                  onChange={(v) => updateGlobal('grid.horizontalColor', v)} />
              </Field>
              <Field label="Width" vertical>
                <RangeInput min={0} max={3} step={0.5} value={getGlobal('grid.horizontalWidth', 1)}
                  onChange={(e) => updateGlobal('grid.horizontalWidth', parseFloat(e.target.value))} />
              </Field>
            </>
          )}
        </SubSection>
        <SubSection label="Vertical lines">
          <Field label="Show">
            <input type="checkbox" checked={getGlobal('grid.verticalLines', false)}
              onChange={(e) => updateGlobal('grid.verticalLines', e.target.checked)} />
          </Field>
          {getGlobal('grid.verticalLines', false) && (
            <>
              <Field label="Color">
                <ColorInput value={getGlobal('grid.verticalColor', '#e2e8f0')}
                  onChange={(v) => updateGlobal('grid.verticalColor', v)} />
              </Field>
              <Field label="Width" vertical>
                <RangeInput min={0} max={3} step={0.5} value={getGlobal('grid.verticalWidth', 1)}
                  onChange={(e) => updateGlobal('grid.verticalWidth', parseFloat(e.target.value))} />
              </Field>
            </>
          )}
        </SubSection>
        <SubSection label="Outer border">
          <Field label="Show">
            <input type="checkbox" checked={getGlobal('grid.outerBorder', false)}
              onChange={(e) => updateGlobal('grid.outerBorder', e.target.checked)} />
          </Field>
          {getGlobal('grid.outerBorder', false) && (
            <>
              <Field label="Color">
                <ColorInput value={getGlobal('grid.outerBorderColor', '#e2e8f0')}
                  onChange={(v) => updateGlobal('grid.outerBorderColor', v)} />
              </Field>
              <Field label="Width" vertical>
                <RangeInput min={0} max={3} step={0.5} value={getGlobal('grid.outerBorderWidth', 1)}
                  onChange={(e) => updateGlobal('grid.outerBorderWidth', parseFloat(e.target.value))} />
              </Field>
            </>
          )}
        </SubSection>
        <Field label="Cell padding" vertical>
          <RangeInput min={2} max={16} value={getGlobal('grid.cellPadding', 8)}
            onChange={(e) => updateGlobal('grid.cellPadding', parseInt(e.target.value))} />
        </Field>
      </Section>

      {/* Rows — always global */}
      <Section title="Rows" sectionState={sections}>
        <Field label="Row height">
          <select value={getGlobal('rows.height', 'normal')}
            onChange={(e) => updateGlobal('rows.height', e.target.value)}
            style={{ ...inputStyle, width: 90, marginBottom: 0 }}>
            <option value="compact">Compact</option>
            <option value="normal">Normal</option>
            <option value="large">Large</option>
          </select>
        </Field>
        <Field label="Striped rows">
          <input type="checkbox" checked={getGlobal('rows.striped', true)}
            onChange={(e) => updateGlobal('rows.striped', e.target.checked)} />
        </Field>
        {getGlobal('rows.striped', true) && (
          <SubSection label="Stripe colors">
            <Field label="Color 1">
              <ColorInput value={getGlobal('rows.stripeColor1', '#ffffff')}
                onChange={(v) => updateGlobal('rows.stripeColor1', v)} />
            </Field>
            <Field label="Color 2">
              <ColorInput value={getGlobal('rows.stripeColor2', '#f8fafc')}
                onChange={(v) => updateGlobal('rows.stripeColor2', v)} />
            </Field>
          </SubSection>
        )}
        <Field label="Hover highlight">
          <input type="checkbox" checked={getGlobal('rows.hoverHighlight', true)}
            onChange={(e) => updateGlobal('rows.hoverHighlight', e.target.checked)} />
        </Field>
        {getGlobal('rows.hoverHighlight', true) && (
          <Field label="Hover color">
            <ColorInput value={getGlobal('rows.hoverColor', '#eef2ff')}
              onChange={(v) => updateGlobal('rows.hoverColor', v)} />
          </Field>
        )}
      </Section>

      {/* Totals — not for pivot table (has its own in Pivot Options) */}
      {!isPivot && <Section title="Totals" sectionState={sections}>
        {colSelect}
        <Field label="Show totals">
          <input type="checkbox" checked={getGlobal('totals.enabled', false)}
            onChange={(e) => updateGlobal('totals.enabled', e.target.checked)} />
        </Field>
        {getGlobal('totals.enabled', false) && (
          <SubSection label="Totals style">
            <Field label="Default fn">
              <select value={getGlobal('totals.defaultFn', 'sum')}
                onChange={(e) => updateGlobal('totals.defaultFn', e.target.value)}
                style={{ ...inputStyle, width: 80, marginBottom: 0 }}>
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="count">Count</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
              </select>
            </Field>
            {selectedCol && (
              <Field label="Col fn">
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
              <input type="checkbox" checked={getGlobal('totals.fontBold', true)}
                onChange={(e) => updateGlobal('totals.fontBold', e.target.checked)} />
            </Field>
            <Field label="Background">
              <ColorInput value={getGlobal('totals.bgColor', '#f1f5f9')}
                onChange={(v) => updateGlobal('totals.bgColor', v)} />
            </Field>
            <Field label="Font color">
              <ColorInput value={getGlobal('totals.fontColor', '#1e293b')}
                onChange={(v) => updateGlobal('totals.fontColor', v)} />
            </Field>
          </SubSection>
        )}
      </Section>}

      {/* Pagination */}
      <Section title="Pagination" sectionState={sections}>
        <Field label="Mode">
          <select value={getGlobal('pagination.mode', 'infinite')}
            onChange={(e) => updateGlobal('pagination.mode', e.target.value)}
            style={{ ...inputStyle, width: 100, marginBottom: 0 }}>
            <option value="infinite">Scroll infini</option>
            <option value="paginated">Paginé</option>
          </select>
        </Field>
        {getGlobal('pagination.mode', 'infinite') === 'paginated' && (
          <Field label="Rows/page">
            <input type="number" min={5} max={500} value={getGlobal('pagination.rowsPerPage', 50)}
              onChange={(e) => updateGlobal('pagination.rowsPerPage', parseInt(e.target.value) || 50)}
              style={{ ...inputStyle, width: 60, marginBottom: 0 }} />
          </Field>
        )}
      </Section>

      {/* Column sizing */}
      <Section title="Column Sizing" sectionState={sections}>
        {colSelect}
        <Field label="Width mode">
          <select value={getGlobal('columnWidthMode', 'auto')}
            onChange={(e) => updateGlobal('columnWidthMode', e.target.value)}
            style={{ ...inputStyle, width: 80, marginBottom: 0 }}>
            <option value="auto">Auto</option>
            <option value="fixed">Fixed</option>
          </select>
        </Field>
        {selectedCol && getGlobal('columnWidthMode', 'auto') === 'fixed' && (
          <Field label="Width (px)">
            <input type="number" min={40} max={600}
              value={tc.columns?.[selectedCol]?.width || ''}
              placeholder="Auto"
              onChange={(e) => updateGlobal(`columns.${selectedCol}.width`, e.target.value ? parseInt(e.target.value) : undefined)}
              style={{ ...inputStyle, width: 65, marginBottom: 0 }} />
          </Field>
        )}
      </Section>

      {/* Conditional formatting — per column only */}
      <Section title="Conditional Format" sectionState={sections}>
        {colSelect}
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
              Field={Field}
              SubSection={SubSection}
              ColorInput={ColorInput}
            />
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' }}>Select a column above</div>
        )}
      </Section>

      {/* Freeze */}
      <Section title="Freeze" sectionState={sections}>
        <Field label="Sticky header">
          <input type="checkbox" checked={getGlobal('freeze.stickyHeader', true)}
            onChange={(e) => updateGlobal('freeze.stickyHeader', e.target.checked)} />
        </Field>
        <Field label="Freeze 1st col">
          <input type="checkbox" checked={getGlobal('freeze.freezeFirstColumn', false)}
            onChange={(e) => updateGlobal('freeze.freezeFirstColumn', e.target.checked)} />
        </Field>
      </Section>
    </>
  );
}

function ConditionalFormatEditor({ rules, onChange, inputStyle, Field, SubSection, ColorInput: CI }) {
  const ColorInput = CI || (({ value, onChange: oc }) => <input type="color" value={value} onChange={(e) => oc(e.target.value)} />);
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

  const updateRule = (idx, key, value) => {
    onChange(rules.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  };

  return (
    <div>
      {rules.map((rule, i) => (
        <SubSection key={i} label={`${rule.type} #${i + 1}`}>
          {rule.type === 'dataBar' && (
            <>
              <Field label="Bar color">
                <ColorInput value={rule.dataBarColor || '#7c3aed'}
                  onChange={(v) => updateRule(i, 'dataBarColor', v)} />
              </Field>
            </>
          )}
          {rule.type === 'colorScale' && (
            <>
              <Field label="Min color">
                <ColorInput value={rule.minColor || '#dcfce7'}
                  onChange={(v) => updateRule(i, 'minColor', v)} />
              </Field>
              <Field label="Min value">
                <input type="number" value={rule.minValue ?? ''} placeholder="Auto"
                  onChange={(e) => updateRule(i, 'minValue', e.target.value !== '' ? parseFloat(e.target.value) : null)}
                  style={{ ...inputStyle, width: 65, marginBottom: 0 }} />
              </Field>
              <Field label="Max color">
                <ColorInput value={rule.maxColor || '#dc2626'}
                  onChange={(v) => updateRule(i, 'maxColor', v)} />
              </Field>
              <Field label="Max value">
                <input type="number" value={rule.maxValue ?? ''} placeholder="Auto"
                  onChange={(e) => updateRule(i, 'maxValue', e.target.value !== '' ? parseFloat(e.target.value) : null)}
                  style={{ ...inputStyle, width: 65, marginBottom: 0 }} />
              </Field>
            </>
          )}
          {rule.type === 'textColor' && (
            <>
              <Field label="Min color">
                <ColorInput value={rule.minColor || '#dc2626'}
                  onChange={(v) => updateRule(i, 'minColor', v)} />
              </Field>
              <Field label="Min value">
                <input type="number" value={rule.minValue ?? ''} placeholder="Auto"
                  onChange={(e) => updateRule(i, 'minValue', e.target.value !== '' ? parseFloat(e.target.value) : null)}
                  style={{ ...inputStyle, width: 65, marginBottom: 0 }} />
              </Field>
              <Field label="Max color">
                <ColorInput value={rule.maxColor || '#16a34a'}
                  onChange={(v) => updateRule(i, 'maxColor', v)} />
              </Field>
              <Field label="Max value">
                <input type="number" value={rule.maxValue ?? ''} placeholder="Auto"
                  onChange={(e) => updateRule(i, 'maxValue', e.target.value !== '' ? parseFloat(e.target.value) : null)}
                  style={{ ...inputStyle, width: 65, marginBottom: 0 }} />
              </Field>
            </>
          )}
          {rule.type === 'icon' && (
            <>
              <IconLevelEditor label="Low ≤" icon={rule.lowIcon ?? '↓'} color={rule.lowColor ?? '#dc2626'}
                value={rule.lowValue} valuePlaceholder="Auto (min)"
                onIconChange={(v) => updateRule(i, 'lowIcon', v)}
                onColorChange={(v) => updateRule(i, 'lowColor', v)}
                onValueChange={(v) => updateRule(i, 'lowValue', v)}
                inputStyle={inputStyle} Field={Field} />
              <IconLevelEditor label="Mid ≤" icon={rule.midIcon ?? '→'} color={rule.midColor ?? '#f59e0b'}
                value={rule.midValue} valuePlaceholder="Auto (avg)"
                onIconChange={(v) => updateRule(i, 'midIcon', v)}
                onColorChange={(v) => updateRule(i, 'midColor', v)}
                onValueChange={(v) => updateRule(i, 'midValue', v)}
                inputStyle={inputStyle} Field={Field} />
              <IconLevelEditor label="High >" icon={rule.highIcon ?? '↑'} color={rule.highColor ?? '#16a34a'}
                value={rule.highValue} valuePlaceholder="Auto (max)"
                onIconChange={(v) => updateRule(i, 'highIcon', v)}
                onColorChange={(v) => updateRule(i, 'highColor', v)}
                onValueChange={(v) => updateRule(i, 'highValue', v)}
                inputStyle={inputStyle} Field={Field} />
            </>
          )}
          <button onClick={() => removeRule(i)}
            style={{ fontSize: 10, color: 'var(--state-danger)', background: 'transparent', border: '1px solid #fca5a5', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', marginTop: 4 }}>
            Remove
          </button>
        </SubSection>
      ))}

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
        {['dataBar', 'colorScale', 'textColor', 'icon'].map((type) => (
          <button key={type} onClick={() => addRule(type)}
            style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--border-default)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            + {type}
          </button>
        ))}
      </div>
    </div>
  );
}

const ICON_PRESETS = ['↑', '↓', '→', '↗', '↘', '●', '▲', '▼', '★', '✓', '✗', '⚠', '♦', '■', '◆'];

function IconLevelEditor({ label, icon, color, value, valuePlaceholder, onIconChange, onColorChange, onValueChange, inputStyle, Field }) {
  const [showPresets, setShowPresets] = useState(false);
  return (
    <div style={iconLevelStyle}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowPresets(!showPresets)}
            style={{ width: 30, height: 26, border: '1px solid var(--border-default)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', fontSize: 14, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </button>
          {showPresets && (
            <div style={presetDropdown}>
              {ICON_PRESETS.map((ic) => (
                <button key={ic} onClick={() => { onIconChange(ic); setShowPresets(false); }}
                  style={{ width: 26, height: 26, border: 'none', background: icon === ic ? '#f5f3ff' : '#fff', cursor: 'pointer', fontSize: 14, borderRadius: 3 }}>
                  {ic}
                </button>
              ))}
              <input type="text" value={icon} placeholder="Custom"
                onChange={(v) => onIconChange(v)}
                style={{ ...inputStyle, width: '100%', marginBottom: 0, marginTop: 4, fontSize: 12, textAlign: 'center' }} />
            </div>
          )}
        </div>
        <ColorInput value={color} onChange={(v) => onColorChange(v)}
          style={{ width: 26, height: 26, border: '1px solid var(--border-default)', borderRadius: 3, padding: 1, cursor: 'pointer' }} />
        <input type="number" value={value ?? ''} placeholder={valuePlaceholder}
          onChange={(e) => onValueChange(e.target.value !== '' ? parseFloat(e.target.value) : null)}
          style={{ ...inputStyle, flex: 1, marginBottom: 0, fontSize: 11 }} />
      </div>
    </div>
  );
}

const iconLevelStyle = {
  padding: '4px 0',
  borderBottom: '1px solid #f8fafc',
};

const presetDropdown = {
  position: 'absolute', top: 30, left: 0, zIndex: 20,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6,
  padding: 6, display: 'flex', flexWrap: 'wrap', gap: 2, width: 170,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
};

const colSelectStyle = {
  marginBottom: 8, padding: '4px 0',
  borderBottom: '1px solid #f1f5f9',
};

const toggleBtn = {
  width: 28, height: 24, border: '1px solid var(--border-default)', borderRadius: 3,
  cursor: 'pointer', fontSize: 11, fontWeight: 600,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
