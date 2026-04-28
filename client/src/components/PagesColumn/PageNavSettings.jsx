import { useState } from 'react';

const FONT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'system-ui, -apple-system, sans-serif', label: 'System' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: '"Helvetica Neue", Helvetica, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: '"Courier New", monospace', label: 'Courier' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet' },
];

const STATES = [
  { key: 'default', label: 'Default' },
  { key: 'hover',   label: 'Hover' },
  { key: 'active',  label: 'Active' },
  { key: 'pressed', label: 'Pressed' },
];

export default function PageNavSettings({ config, pages, onChange, onClose }) {
  const [expandedPageId, setExpandedPageId] = useState(null);
  const [openState, setOpenState] = useState({}); // { [pageId]: 'default' | 'hover' | ... }

  const update = (key, value) => onChange({ ...config, [key]: value });

  // Migrate any legacy form to { position, default: { image, bg, text, font }, ... } when reading.
  const getPageCfg = (pageId) => {
    const raw = (config.pageIcons || {})[pageId];
    const empty = { default: {}, hover: {}, active: {}, pressed: {}, position: 'left' };
    if (!raw) return empty;
    if (typeof raw === 'string') return { ...empty, default: { image: raw } };
    const out = { ...empty, position: raw.position || 'left' };
    for (const s of ['default', 'hover', 'active', 'pressed']) {
      const v = raw[s];
      if (typeof v === 'string') out[s] = { image: v };
      else if (v && typeof v === 'object') out[s] = { ...v };
      else out[s] = {};
    }
    return out;
  };

  const writePageCfg = (pageId, cfg) => {
    const next = { ...(config.pageIcons || {}) };
    const isEmpty = cfg.position === 'left' && STATES.every(({ key }) => {
      const s = cfg[key] || {};
      return !s.image && !s.bg && !s.text && !s.font;
    });
    if (isEmpty) delete next[pageId];
    else next[pageId] = cfg;
    onChange({ ...config, pageIcons: next });
  };

  const updatePagePosition = (pageId, pos) => {
    const cfg = getPageCfg(pageId);
    writePageCfg(pageId, { ...cfg, position: pos });
  };

  const updatePageState = (pageId, state, key, value) => {
    const cfg = getPageCfg(pageId);
    const nextState = { ...cfg[state] };
    if (value == null || value === '') delete nextState[key];
    else nextState[key] = value;
    writePageCfg(pageId, { ...cfg, [state]: nextState });
  };

  const handleFile = (e, cb) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => cb(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Page Navigation</span>
          <button onClick={onClose} style={closeBtn}>x</button>
        </div>

        <Section title="Block">
          <ColorField label="Background" value={config.bgColor} onChange={(v) => update('bgColor', v)} allowTransparent />
          <Field label="Width (px)">
            <input
              type="number" min={120} max={320}
              value={config.width || 150}
              onChange={(e) => update('width', parseInt(e.target.value, 10) || 150)}
              style={inputStyle}
            />
          </Field>
        </Section>

        <Section title="All pages">
          <Field label="Position">
            {(() => {
              const raw = config.pagesAlignment;
              const cur = typeof raw === 'number' ? raw
                : raw === 'center' ? 50
                : raw === 'bottom' ? 100
                : 0;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 160 }}>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={cur}
                    onChange={(e) => update('pagesAlignment', parseInt(e.target.value, 10))}
                    style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent-primary)' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-disabled)', minWidth: 36, textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {cur}%
                  </span>
                </div>
              );
            })()}
          </Field>
          <Field label="Button height (px)">
            <input
              type="number" min={20} max={80}
              value={config.buttonSize || 32}
              onChange={(e) => update('buttonSize', parseInt(e.target.value, 10) || 32)}
              style={inputStyle}
            />
          </Field>
          <Field label="Font family">
            <select
              value={config.fontFamily || ''}
              onChange={(e) => update('fontFamily', e.target.value)}
              style={{ ...inputStyle, width: 130 }}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value || 'default'} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Font size (px)">
            <input
              type="number" min={9} max={24}
              value={config.fontSize || 12}
              onChange={(e) => update('fontSize', parseInt(e.target.value, 10) || 12)}
              style={inputStyle}
            />
          </Field>
        </Section>

        <Section title="Header">
          <Field label="Title">
            <input
              type="text"
              value={config.title || ''}
              onChange={(e) => update('title', e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Logo">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFile(e, (v) => update('logo', v))}
              style={{ fontSize: 11, width: '100%' }}
            />
          </Field>
          {config.logo && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <img
                src={config.logo}
                alt=""
                style={{
                  width: 48, height: 48, objectFit: 'contain',
                  border: '1px solid var(--border-default)', borderRadius: 4,
                  background: 'var(--bg-subtle)',
                }}
              />
              <button onClick={() => update('logo', null)} style={removeBtn}>Remove logo</button>
            </div>
          )}
          <Field label="Layout">
            <SegmentedToggle
              value={config.headerLayout || 'horizontal'}
              onChange={(v) => update('headerLayout', v)}
              options={[
                { value: 'horizontal', label: 'Horizontal' },
                { value: 'vertical',   label: 'Vertical' },
              ]}
            />
          </Field>
          <Field label="Logo position">
            <SegmentedToggle
              value={config.headerLogoPosition || 'before'}
              onChange={(v) => update('headerLogoPosition', v)}
              options={(config.headerLayout || 'horizontal') === 'vertical'
                ? [{ value: 'before', label: 'Top' }, { value: 'after', label: 'Bottom' }]
                : [{ value: 'before', label: 'Left' }, { value: 'after', label: 'Right' }]}
            />
          </Field>
          <Field label="Alignment">
            <SegmentedToggle
              value={config.headerAlign || 'left'}
              onChange={(v) => update('headerAlign', v)}
              options={[
                { value: 'left',   label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right',  label: 'Right' },
              ]}
            />
          </Field>
        </Section>

        <Section title="Per page">
          {pages.map((p) => {
            const cfg = getPageCfg(p.id);
            const previewIcon = cfg.default.image || cfg.active.image || cfg.hover.image || cfg.pressed.image;
            const isOpen = expandedPageId === p.id;
            const activeState = openState[p.id] || 'default';

            return (
              <div key={p.id} style={pageItemBox}>
                <div
                  onClick={() => setExpandedPageId(isOpen ? null : p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                    cursor: 'pointer', background: isOpen ? 'var(--bg-subtle)' : 'transparent',
                    userSelect: 'none',
                  }}
                >
                  {previewIcon ? (
                    <img src={previewIcon} alt="" style={previewImg} />
                  ) : (
                    <div style={previewImgEmpty} />
                  )}
                  <span style={{
                    fontSize: 11, flex: 1, color: 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p.name}</span>
                  <span style={{
                    fontSize: 9, color: 'var(--text-disabled)',
                    transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.15s',
                  }}>▼</span>
                </div>

                {isOpen && (
                  <div style={{ padding: '6px 8px', borderTop: '1px solid var(--border-default)' }}>
                    <Field label="Image position">
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          { value: 'left',   label: 'Left' },
                          { value: 'right',  label: 'Right' },
                          { value: 'center', label: 'Center' },
                        ].map(({ value, label }) => (
                          <button
                            key={value}
                            onClick={() => updatePagePosition(p.id, value)}
                            style={{
                              ...presetBtn,
                              borderColor: cfg.position === value ? 'var(--accent-primary)' : 'var(--border-default)',
                              background: cfg.position === value ? 'var(--bg-active)' : 'var(--bg-panel)',
                              color: cfg.position === value ? 'var(--accent-primary)' : 'var(--text-secondary)',
                              fontWeight: cfg.position === value ? 600 : 400,
                            }}
                          >{label}</button>
                        ))}
                      </div>
                    </Field>

                    {/* State tabs */}
                    <div style={{ display: 'flex', gap: 2, marginBottom: 6, marginTop: 4 }}>
                      {STATES.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setOpenState((s) => ({ ...s, [p.id]: key }))}
                          style={{
                            flex: 1, fontSize: 10, padding: '4px 0',
                            border: 'none', borderBottom: '2px solid ' + (activeState === key ? 'var(--accent-primary)' : 'transparent'),
                            background: 'transparent', cursor: 'pointer',
                            color: activeState === key ? 'var(--accent-primary)' : 'var(--text-muted)',
                            fontWeight: activeState === key ? 600 : 400,
                          }}
                        >{label}</button>
                      ))}
                    </div>

                    {/* State-specific controls */}
                    <ColorField
                      label="Background"
                      value={cfg[activeState].bg}
                      onChange={(v) => updatePageState(p.id, activeState, 'bg', v)}
                      allowTransparent
                    />
                    <ColorField
                      label="Text"
                      value={cfg[activeState].text}
                      onChange={(v) => updatePageState(p.id, activeState, 'text', v)}
                      allowTransparent
                    />
                    <Field label="Font family">
                      <select
                        value={cfg[activeState].font || ''}
                        onChange={(e) => updatePageState(p.id, activeState, 'font', e.target.value)}
                        style={{ ...inputStyle, width: 130 }}
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f.value || 'inherit'} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </Field>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 11, flex: 1, color: 'var(--text-secondary)' }}>Image</span>
                      {cfg[activeState].image ? (
                        <>
                          <img src={cfg[activeState].image} alt="" style={previewImg} />
                          <button
                            onClick={() => updatePageState(p.id, activeState, 'image', null)}
                            style={removeIconBtn}
                            title="Remove image"
                          >×</button>
                        </>
                      ) : (
                        <label style={uploadLabel}>
                          Upload
                          <input
                            type="file" accept="image/*"
                            onChange={(e) => handleFile(e, (v) => updatePageState(p.id, activeState, 'image', v))}
                            style={{ display: 'none' }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange, allowTransparent }) {
  const isTransparent = value === 'transparent';
  const isCustom = value != null && value !== '' && !isTransparent;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          type="color"
          value={isCustom ? value : '#888888'}
          onChange={(e) => onChange(e.target.value)}
          disabled={isTransparent}
          style={{
            width: 24, height: 22, padding: 0, border: '1px solid var(--border-default)',
            borderRadius: 3, cursor: isTransparent ? 'default' : 'pointer',
            background: 'transparent', opacity: isTransparent ? 0.4 : 1,
          }}
        />
        <input
          type="text"
          value={isCustom ? value : (isTransparent ? 'transparent' : '')}
          placeholder="auto"
          onChange={(e) => {
            const v = e.target.value.trim();
            if (v === 'transparent') onChange('transparent');
            else onChange(v || null);
          }}
          style={{
            width: 64, padding: '2px 4px', fontSize: 10,
            border: '1px solid var(--border-default)', borderRadius: 4,
            background: 'var(--bg-panel)', color: 'var(--text-primary)',
          }}
        />
        {allowTransparent && (
          <button
            onClick={() => onChange(isTransparent ? '#ffffff' : 'transparent')}
            title={isTransparent ? 'Set color' : 'Set transparent'}
            style={{
              width: 22, height: 22, padding: 0,
              border: '1px solid var(--border-default)', borderRadius: 3,
              cursor: 'pointer', fontSize: 11, lineHeight: 1, fontWeight: 700,
              background: isTransparent
                ? 'var(--bg-panel)'
                : 'repeating-conic-gradient(var(--border-default) 0% 25%, var(--bg-panel) 0% 50%) 50%/12px 12px',
              color: isTransparent ? 'var(--accent-primary)' : 'var(--text-disabled)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >∅</button>
        )}
        <button
          onClick={() => onChange(null)}
          disabled={!isCustom && !isTransparent}
          title="Reset to theme default"
          style={{
            ...miniBtn,
            opacity: (isCustom || isTransparent) ? 1 : 0.3,
            cursor: (isCustom || isTransparent) ? 'pointer' : 'default',
          }}
        >×</button>
      </div>
    </div>
  );
}

function SegmentedToggle({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map((opt) => {
        const sel = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              ...presetBtn,
              borderColor: sel ? 'var(--accent-primary)' : 'var(--border-default)',
              background: sel ? 'var(--bg-active)' : 'var(--bg-panel)',
              color: sel ? 'var(--accent-primary)' : 'var(--text-secondary)',
              fontWeight: sel ? 600 : 400,
            }}
          >{opt.label}</button>
        );
      })}
    </div>
  );
}

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid var(--border-default)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 10px', background: 'var(--bg-subtle)',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 10, color: 'var(--text-disabled)', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>▼</span>
      </div>
      {open && <div style={{ padding: '8px 10px 4px' }}>{children}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
      <div style={{ flexShrink: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 200,
  display: 'flex', justifyContent: 'flex-end',
};

const panelStyle = {
  width: 320, backgroundColor: 'var(--bg-panel)', height: '100%',
  boxShadow: '-4px 0 12px rgba(0,0,0,0.15)', padding: 16, overflowY: 'auto',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-default)',
};

const closeBtn = {
  fontSize: 18, background: 'transparent', border: 'none',
  color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700,
};

const inputStyle = {
  padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 12, outline: 'none', width: 150,
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
};

const removeBtn = {
  fontSize: 11, padding: '4px 8px', border: '1px solid var(--state-danger)',
  borderRadius: 4, background: 'transparent', color: 'var(--state-danger)',
  cursor: 'pointer',
};

const removeIconBtn = {
  fontSize: 14, width: 22, height: 22, padding: 0,
  border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', color: 'var(--state-danger)',
  cursor: 'pointer', lineHeight: 1,
};

const uploadLabel = {
  fontSize: 11, padding: '4px 10px', border: '1px solid var(--border-default)',
  borderRadius: 4, background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const miniBtn = {
  fontSize: 10, fontWeight: 700, width: 22, height: 22, padding: 0,
  border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', color: 'var(--text-muted)',
  cursor: 'pointer', lineHeight: 1,
};

const presetBtn = {
  fontSize: 10, padding: '3px 8px', border: '1px solid var(--border-default)',
  borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer',
  color: 'var(--text-secondary)', textTransform: 'capitalize',
};

const pageItemBox = {
  marginBottom: 6,
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  overflow: 'hidden',
  background: 'var(--bg-panel)',
};

const previewImg = {
  width: 22, height: 22, objectFit: 'contain', flexShrink: 0,
  border: '1px solid var(--border-default)', borderRadius: 3,
  background: 'var(--bg-subtle)',
};

const previewImgEmpty = {
  width: 22, height: 22, borderRadius: 3, flexShrink: 0,
  background: 'var(--bg-subtle)', border: '1px dashed var(--border-default)',
};
