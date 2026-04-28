import { useState } from 'react';
import { TbCheck } from 'react-icons/tb';
import { useTheme } from '../../hooks/useTheme';

export default function SettingsPanel({ settings, onSettingsChange, onClose }) {
  const { themes: availableThemes } = useTheme();
  const update = (key, value) => {
    onSettingsChange({ ...settings, [key]: value });
  };
  const setReportTheme = (themeKey) => {
    const t = availableThemes?.[themeKey];
    if (!t) return;
    onSettingsChange({ ...settings, theme: { key: themeKey, ...t } });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      update('backgroundImage', ev.target.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Settings</span>
          <button onClick={onClose} style={closeBtn}>x</button>
        </div>

        <Section title="Report Theme">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(availableThemes || {}).map(([key, t]) => {
              const active = settings?.theme?.key === key;
              return (
                <button key={key} onClick={() => setReportTheme(key)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 6,
                    border: '1px solid ' + (active ? 'var(--accent-primary)' : 'var(--border-default)'),
                    background: active ? 'var(--bg-active)' : 'var(--bg-panel)',
                    color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: active ? 600 : 500,
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      display: 'inline-block', width: 16, height: 16, borderRadius: 4,
                      background: t.vars?.['--bg-app'] || '#fff',
                      border: '1px solid ' + (t.vars?.['--border-default'] || '#e2e8f0'),
                    }} />
                    <span>{t.label || key}</span>
                  </span>
                  {active && <TbCheck size={14} />}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="View Mode">
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {[
              { value: 'actual', label: 'Actual size' },
              { value: 'fitToWidth', label: 'Fit to width' },
              { value: 'fitToPage', label: 'Fit to page' },
            ].map((mode) => (
              <button
                key={mode.value}
                onClick={() => update('viewMode', mode.value)}
                style={{
                  ...presetBtn,
                  background: (settings.viewMode || 'fitToWidth') === mode.value ? 'var(--bg-active)' : 'var(--bg-panel)',
                  borderColor: (settings.viewMode || 'fitToWidth') === mode.value ? 'var(--accent-primary)' : 'var(--border-default)',
                  color: (settings.viewMode || 'fitToWidth') === mode.value ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  fontWeight: (settings.viewMode || 'fitToWidth') === mode.value ? 600 : 400,
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Page Size">
          <Field label="Width (px)">
            <input
              type="number" min={400} max={3000}
              value={settings.pageWidth || 1140}
              onChange={(e) => update('pageWidth', parseInt(e.target.value) || 1140)}
              style={inputStyle}
            />
          </Field>
          <Field label="Height (px)">
            <input
              type="number" min={400} max={5000}
              value={settings.pageHeight || 800}
              onChange={(e) => update('pageHeight', parseInt(e.target.value) || 800)}
              style={inputStyle}
            />
          </Field>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {[
              { label: '16:9', w: 1280, h: 720 },
              { label: '16:10', w: 1280, h: 800 },
              { label: '4:3', w: 1024, h: 768 },
              { label: 'A4 Portrait', w: 794, h: 1123 },
              { label: 'A4 Landscape', w: 1123, h: 794 },
              { label: 'Letter', w: 816, h: 1056 },
              { label: 'Full HD', w: 1920, h: 1080 },
              { label: '2K', w: 2560, h: 1440 },
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => { update('pageWidth', preset.w); update('pageHeight', preset.h); }}
                style={{
                  ...presetBtn,
                  background: settings.pageWidth === preset.w && settings.pageHeight === preset.h ? 'var(--bg-active)' : 'var(--bg-panel)',
                  borderColor: settings.pageWidth === preset.w && settings.pageHeight === preset.h ? 'var(--accent-primary)' : 'var(--border-default)',
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Canvas">
          <Field label="Snap to grid">
            <input
              type="checkbox"
              checked={settings.snapToGrid ?? true}
              onChange={(e) => update('snapToGrid', e.target.checked)}
            />
          </Field>
          {settings.snapToGrid && (
            <>
              <Field label="Grid size (px)">
                <input
                  type="number" min={5} max={100}
                  value={settings.gridSize || 20}
                  onChange={(e) => update('gridSize', parseInt(e.target.value) || 20)}
                  style={inputStyle}
                />
              </Field>
              <Field label="Show grid">
                <input
                  type="checkbox"
                  checked={settings.showGrid ?? false}
                  onChange={(e) => update('showGrid', e.target.checked)}
                />
              </Field>
            </>
          )}
        </Section>

        <Section title="Background">
          <Field label="Color">
            <input
              type="color"
              value={settings.backgroundColor || '#ffffff'}
              onChange={(e) => update('backgroundColor', e.target.value)}
            />
          </Field>
          <Field label="Transparent">
            <input
              type="checkbox"
              checked={settings.transparentBg ?? false}
              onChange={(e) => update('transparentBg', e.target.checked)}
            />
          </Field>
          {!settings.transparentBg && (
            <>
              <Field label="Image">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ fontSize: 12, width: '100%' }}
                />
              </Field>
              {settings.backgroundImage && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Preview:</div>
                  <div style={{
                    width: '100%', height: 80, borderRadius: 4, border: '1px solid var(--border-default)',
                    backgroundImage: `url(${settings.backgroundImage})`,
                    backgroundSize: 'cover', backgroundPosition: 'center',
                  }} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    {['cover', 'contain', 'repeat'].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => update('backgroundSize', mode)}
                        style={{
                          ...presetBtn,
                          background: (settings.backgroundSize || 'cover') === mode ? 'var(--bg-active)' : 'var(--bg-panel)',
                          borderColor: (settings.backgroundSize || 'cover') === mode ? 'var(--accent-primary)' : 'var(--border-default)',
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => update('backgroundImage', null)}
                    style={{ ...presetBtn, color: 'var(--state-danger)', borderColor: 'var(--state-danger)', marginTop: 6 }}
                  >
                    Remove image
                  </button>
                </div>
              )}
            </>
          )}
        </Section>

        <Section title="Report Border">
          <Field label="Show border">
            <input
              type="checkbox"
              checked={settings.showBorder ?? true}
              onChange={(e) => update('showBorder', e.target.checked)}
            />
          </Field>
          <Field label="Border radius">
            <input
              type="range" min={0} max={24}
              value={settings.borderRadius ?? 8}
              onChange={(e) => update('borderRadius', parseInt(e.target.value))}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-disabled)', marginLeft: 4 }}>{settings.borderRadius ?? 8}px</span>
          </Field>
          <Field label="Shadow">
            <input
              type="checkbox"
              checked={settings.showShadow ?? true}
              onChange={(e) => update('showShadow', e.target.checked)}
            />
          </Field>
        </Section>
      </div>
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
          padding: '6px 10px',
          background: 'var(--bg-subtle)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 10, color: 'var(--text-disabled)', transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
      </div>
      {open && <div style={{ padding: '8px 10px 4px' }}>{children}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</span>
      <div style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 100,
  display: 'flex', justifyContent: 'flex-end',
};

const panelStyle = {
  width: 280, backgroundColor: 'var(--bg-panel)', height: '100%',
  boxShadow: '-4px 0 12px rgba(0,0,0,0.1)', padding: 16, overflowY: 'auto',
};

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border-default)',
};

const closeBtn = {
  fontSize: 18, background: 'transparent', border: 'none', color: 'var(--text-muted)',
  cursor: 'pointer', fontWeight: 700,
};

const inputStyle = {
  padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 13, outline: 'none', width: 100, textAlign: 'right',
};

const presetBtn = {
  fontSize: 11, padding: '4px 8px', border: '1px solid var(--border-default)',
  borderRadius: 4, background: 'var(--bg-panel)', cursor: 'pointer', color: 'var(--text-secondary)',
};
