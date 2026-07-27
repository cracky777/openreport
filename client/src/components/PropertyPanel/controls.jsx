// Self-contained UI primitive controls for the widget config panel (form fields,
// layout wrappers, color/range/decimal inputs, the scorecard compare-line editor).
// Extracted verbatim from PropertyPanel.jsx (LOT 6.3). Stateless except local
// state; the parent still owns section-collapse state and passes it as a prop.
import { useState, useEffect, useRef } from 'react';
import { TbChevronDown } from 'react-icons/tb';
import { parseIntOrNull } from '../../utils/input';

const _hs41 = { marginBottom: 8 };
const _hs42 = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' };
const _hs43 = { padding: '8px 10px 4px' };
const _hs44 = { marginTop: 6, marginBottom: 6 };
const _hs45 = { fontSize: 10, fontWeight: 600, color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: 4 };
const _hs46 = { display: 'flex', gap: 2, marginBottom: 6, justifyContent: 'flex-start' };
const _hs47 = { marginBottom: 6 };
const _hs48 = { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3 };
const _hs49 = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 };
const _hs50 = { fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 };
const _hs51 = { flexShrink: 1, minWidth: 0, overflow: 'hidden' };
const _hs52 = { display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 };
const _hs53 = { flex: 1, minWidth: 0 };
const _hs54 = { width: 48, minWidth: 48, padding: '2px 3px', border: '1px solid var(--border-default)', borderRadius: 3, fontSize: 11, textAlign: 'center', outline: 'none', boxSizing: 'border-box', flexShrink: 0 };
const _hs55 = { fontSize: 10, color: 'var(--text-disabled)', flexShrink: 0 };
const _hs56 = { display: 'flex', alignItems: 'center', gap: 3 };
const _hs57 = {
      border: '1px solid var(--border-default)', borderRadius: 8,
      overflow: 'hidden', background: 'var(--bg-panel)',
      boxShadow: '0 1px 1px rgba(15,23,42,0.02)',
    };
const _hs58 = {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', cursor: 'pointer', userSelect: 'none', gap: 8,
          background: 'var(--bg-panel)',
        };
const _hs59 = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
const _hs60 = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const _hs61 = { padding: '8px 10px 4px', borderTop: '1px solid var(--border-default)' };

function Section({ title, children, defaultOpen, sectionState, bare }) {
  if (bare) {
    return <div style={_hs41}>{children}</div>;
  }

  // Default: closed for collapsible sections, open for non-collapsible
  const defOpen = defaultOpen ?? (sectionState ? false : true);
  const isCollapsed = sectionState ? sectionState.collapsed[title] ?? !defOpen : false;
  const toggle = sectionState ? () => sectionState.toggle(title) : undefined;

  return (
    <div style={sectionStyle}>
      <div onClick={toggle} style={{ ...sectionHeaderStyle, cursor: toggle ? 'pointer' : 'default' }}>
        <span style={_hs42}>{title}</span>
        {toggle && (
          <span style={{ display: 'inline-flex', color: 'var(--text-disabled)', transition: 'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <TbChevronDown size={14} />
          </span>
        )}
      </div>
      {!isCollapsed && (
        <div style={_hs43}>
          {children}
        </div>
      )}
    </div>
  );
}

function SubSection({ label, children }) {
  return (
    <div style={_hs44}>
      <div style={_hs45}>{label}</div>
      <div style={subSectionStyle}>
        {children}
      </div>
    </div>
  );
}

function AlignButtonGroup({ value, onChange, options }) {
  return (
    <div style={_hs46}>
      {options.map(({ v, Icon, title }) => {
        const active = value === v;
        return (
          <button key={v} type="button" title={title}
            onClick={() => onChange(v)}
            style={{
              border: '1px solid var(--border-default)',
              background: active ? 'var(--bg-active)' : 'transparent',
              color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
              padding: '4px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children, vertical }) {
  if (vertical) {
    return (
      <div style={_hs47}>
        <div style={_hs48}>{label}</div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div style={_hs49}>
      <span style={_hs50}>{label}</span>
      <div style={_hs51}>{children}</div>
    </div>
  );
}

function DecimalInput({ value, onChange, placeholder, style }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const prevValueRef = useRef(value);
  // Re-sync local text when the external value changes (and isn't the same number we emitted)
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    const parsed = parseFloat((text || '').replace(',', '.'));
    // Controlled-input re-sync (relocated verbatim from PropertyPanel): mirror the
    // external `value` into local text — a legitimate effect-driven sync, not a
    // render-time derivation. Behaviour preserved.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (value == null) {
      if (text !== '') setText('');
    } else if (parsed !== value) {
      setText(String(value));
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw === '' || raw === '-') { onChange(undefined); return; }
        // Allow only digits, one separator (, or .), optional leading minus
        if (!/^-?\d*[.,]?\d*$/.test(raw)) return;
        const parsed = parseFloat(raw.replace(',', '.'));
        if (!isNaN(parsed)) { prevValueRef.current = parsed; onChange(parsed); }
      }}
      onBlur={() => {
        // Normalize display on blur (e.g. "1," → "1")
        const parsed = parseFloat((text || '').replace(',', '.'));
        if (!isNaN(parsed)) setText(String(parsed));
      }}
      style={style}
    />
  );
}

function RangeInput({ min, max, step, value, onChange, suffix }) {
  return (
    <div style={_hs52}>
      <input type="range" min={min} max={max} step={step || 1} value={value}
        onChange={onChange} style={_hs53} />
      <input type="number" min={min} max={max} step={step || 1} value={value}
        onChange={onChange}
        style={_hs54} />
      {suffix && <span style={_hs55}>{suffix}</span>}
    </div>
  );
}

function ColorInput({ value, onChange }) {
  const isTransparent = value === 'transparent' || value === '';
  return (
    <div style={_hs56}>
      <input type="color" value={isTransparent ? '#ffffff' : value}
        onChange={(e) => onChange(e.target.value)}
        style={{ opacity: isTransparent ? 0.3 : 1 }} />
      <button
        onClick={() => onChange(isTransparent ? '#ffffff' : 'transparent')}
        title={isTransparent ? 'Set color' : 'Set transparent'}
        style={{
          width: 22, height: 22, border: '1px solid var(--border-default)', borderRadius: 3,
          cursor: 'pointer', fontSize: 11, lineHeight: 1,
          background: isTransparent ? 'var(--bg-panel)' : 'repeating-conic-gradient(var(--border-default) 0% 25%, var(--bg-panel) 0% 50%) 50%/12px 12px',
          color: isTransparent ? 'var(--accent-primary)' : 'var(--text-disabled)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, flexShrink: 0,
        }}
      >
        ∅
      </button>
    </div>
  );
}

function CompareLineEditor({ title, checked, onToggle, style, defaultLabel, onStyleChange, hasSign }) {
  const [open, setOpen] = useState(false);
  const s = style || {};
  const update = (patch) => onStyleChange({ ...s, ...patch });
  const inputStyle = compareInputStyle;
  // Inputs use width:100% so they shrink to fit the Field's right cell
  // (which has minWidth:0 + overflow:hidden) and never get truncated by
  // the panel's narrow default width.
  const fillStyle = { ...inputStyle, width: '100%' };
  const textColorOn = s.textColorEnabled !== false; // back-compat: legacy `colorEnabled` falls back via the renderer
  // Value-kind icon defaults OFF (no sign means no implicit symbol);
  // delta kinds default ON to match the previous behavior.
  const iconOn = hasSign ? (s.iconEnabled !== false) : (s.iconEnabled === true);
  const iconColorOn = s.iconColorEnabled !== false;
  return (
    <div style={_hs57}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={_hs58}
      >
        <div style={_hs59}>
          <input
            type="checkbox" checked={checked}
            onChange={(e) => onToggle(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
          <span style={_hs60}>{title}</span>
        </div>
        <span style={{ display: 'inline-flex', color: 'var(--text-disabled)', transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <TbChevronDown size={14} />
        </span>
      </div>
      {open && (
        <div style={_hs61}>
          <Field label="Position">
            <select value={s.position || 'bottom'} onChange={(e) => update({ position: e.target.value })}
              style={fillStyle}>
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </Field>
          <Field label="Label">
            <input type="text" value={s.label ?? defaultLabel}
              onChange={(e) => update({ label: e.target.value })}
              placeholder={defaultLabel}
              style={fillStyle} />
          </Field>
          <Field label="Font size">
            <input type="number" min={8} max={32} value={s.fontSize ?? 12}
              onChange={(e) => update({ fontSize: Math.max(8, parseIntOrNull(e.target.value)) })}
              style={fillStyle} />
          </Field>
          <Field label="Spacing">
            <input type="number" min={0} max={64} value={s.spacing ?? 6}
              onChange={(e) => update({ spacing: Math.max(0, parseIntOrNull(e.target.value)) })}
              style={fillStyle} />
          </Field>
          {hasSign && (
            <>
              <Field label="Color text on sign">
                <input type="checkbox" checked={textColorOn}
                  onChange={(e) => update({ textColorEnabled: e.target.checked })} />
              </Field>
              {textColorOn && (
                <SubSection label="Text color">
                  <Field label="Positive">
                    <ColorInput value={s.positiveColor || '#16a34a'} onChange={(v) => update({ positiveColor: v })} />
                  </Field>
                  <Field label="Negative">
                    <ColorInput value={s.negativeColor || '#dc2626'} onChange={(v) => update({ negativeColor: v })} />
                  </Field>
                </SubSection>
              )}
            </>
          )}
          <Field label={hasSign ? 'Show trend icon' : 'Show icon'}>
            <input type="checkbox" checked={iconOn}
              onChange={(e) => update({ iconEnabled: e.target.checked })} />
          </Field>
          {iconOn && (
            <SubSection label="Icon">
              <Field label="Position">
                <select value={s.iconPosition || 'left'}
                  onChange={(e) => update({ iconPosition: e.target.value })}
                  style={fillStyle}>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </Field>
              <Field label="Up">
                <input type="text" value={s.positiveIcon ?? '▲'}
                  onChange={(e) => update({ positiveIcon: e.target.value })}
                  style={{ ...fillStyle, textAlign: 'center' }} />
              </Field>
              <Field label="Down">
                <input type="text" value={s.negativeIcon ?? '▼'}
                  onChange={(e) => update({ negativeIcon: e.target.value })}
                  style={{ ...fillStyle, textAlign: 'center' }} />
              </Field>
              <Field label="Color icon on sign">
                <input type="checkbox" checked={iconColorOn}
                  onChange={(e) => update({ iconColorEnabled: e.target.checked })} />
              </Field>
              {iconColorOn && (
                <>
                  <Field label="Positive">
                    <ColorInput value={s.iconPositiveColor || '#16a34a'}
                      onChange={(v) => update({ iconPositiveColor: v })} />
                  </Field>
                  <Field label="Negative">
                    <ColorInput value={s.iconNegativeColor || '#dc2626'}
                      onChange={(v) => update({ iconNegativeColor: v })} />
                  </Field>
                </>
              )}
            </SubSection>
          )}
        </div>
      )}
    </div>
  );
}

const compareInputStyle = {
  padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 12, outline: 'none', boxSizing: 'border-box',
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
};

const sectionStyle = {
  marginBottom: 8,
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'var(--bg-panel)',
  boxShadow: '0 1px 1px rgba(15,23,42,0.02)',
};

const sectionHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 12px',
  background: 'var(--bg-panel)',
  borderBottom: '1px solid transparent',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background 0.12s, border-color 0.12s',
};

const subSectionStyle = {
  marginTop: 6, marginBottom: 6,
  padding: '8px 8px',
  border: '1px solid #eef2f7',
  borderRadius: 6,
  background: 'var(--bg-subtle)',
  overflow: 'hidden',
};

export {
  Section,
  SubSection,
  AlignButtonGroup,
  Field,
  DecimalInput,
  RangeInput,
  ColorInput,
  CompareLineEditor,
};
